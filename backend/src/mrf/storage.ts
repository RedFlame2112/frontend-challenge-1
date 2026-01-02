import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "./utils.js";
import type { GeneratedMrf, MrfCustomerRecord, MrfFileRecord, MrfIndex } from "./types.js";


export class MrfStorage {
  private readonly baseDir: string;
  private readonly indexPath: string;

  constructor(baseDir = path.resolve(process.cwd(), "data", "mrf")) {
    this.baseDir = baseDir;
    this.indexPath = path.join(this.baseDir, "index.json");
  }

  async save(generated: GeneratedMrf): Promise<MrfFileRecord> {
    await this.ensureDir(this.baseDir);
    const customerKey = slugify(generated.customerKey);
    const customerDir = path.join(this.baseDir, customerKey);
    await this.ensureDir(customerDir);

    const filePath = path.join(customerDir, generated.fileName);
    const payload = JSON.stringify(generated.data, null, 2);
    await writeFile(filePath, payload, "utf-8");
    const fileStats = await stat(filePath);

    const record: MrfFileRecord = {
      customerId: generated.customerId,
      customerKey,
      customerName: generated.customerName,
      fileName: generated.fileName,
      createdAt: new Date().toISOString(),
      claimCount: generated.claimCount,
      size: fileStats.size,
    };

    // Maintain a lightweight index for fast list lookups.
    const index = await this.readIndex();
    const existingCustomer = index.customers[generated.customerId];
    const customerRecord: MrfCustomerRecord = existingCustomer ?? {
      id: generated.customerId,
      key: customerKey,
      name: generated.customerName,
      files: [],
    };

    customerRecord.key = customerKey;
    customerRecord.name = generated.customerName;
    customerRecord.files.unshift(record);
    index.customers[generated.customerId] = customerRecord;

    await this.writeIndex(index);
    return record;
  }

  async list(customerId?: string): Promise<MrfCustomerRecord[]> {
    const index = await this.readIndex();
    if (!customerId) {
      return Object.values(index.customers);
    }

    const customer = index.customers[customerId];
    return customer ? [customer] : [];
  }

  async readFile(customerId: string, fileName: string): Promise<string | null> {
    const index = await this.readIndex();
    const customer = index.customers[customerId];
    if (!customer) {
      return null;
    }

    const safeFileName = path.basename(fileName);
    const filePath = path.join(this.baseDir, customer.key, safeFileName);

    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  private async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  private async readIndex(): Promise<MrfIndex> {
    try {
      const data = await readFile(this.indexPath, "utf-8");
      return JSON.parse(data) as MrfIndex;
    } catch {
      return { customers: {} };
    }
  }

  private async writeIndex(index: MrfIndex): Promise<void> {
    const payload = JSON.stringify(index, null, 2);
    await writeFile(this.indexPath, payload, "utf-8");
  }
}

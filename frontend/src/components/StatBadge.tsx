//NOTE: This is just a wrapper around mantine badge it is NOT custom
import { Badge } from "@mantine/core";

type StatBadgeProps = {
  label: string;
  value: string | number;
  color?: string;
};

// Compact label/value badge for summary rows.
export default function StatBadge({ label, value, color = "blue" }: StatBadgeProps) {
  // Color-coded badge keeps metrics scannable in dense layouts.
  return (
    <Badge color={color}>
      {label}: {value}
    </Badge>
  );
}

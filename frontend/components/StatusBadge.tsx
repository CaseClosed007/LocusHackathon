import { ThoughtType } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  type: ThoughtType;
  pulse?: boolean;
}

const CONFIG: Record<
  ThoughtType,
  { label: string; dot: string; text: string; border: string; bg: string }
> = {
  thought: {
    label: "THINK",
    dot:    "bg-blue-400",
    text:   "text-blue-300",
    border: "border-blue-500/30",
    bg:     "bg-blue-500/10",
  },
  action: {
    label: "RUN",
    dot:    "bg-purple-400",
    text:   "text-purple-300",
    border: "border-purple-500/30",
    bg:     "bg-purple-500/10",
  },
  healing: {
    label: "HEAL",
    dot:    "bg-amber-400",
    text:   "text-amber-300",
    border: "border-amber-500/30",
    bg:     "bg-amber-500/10",
  },
  success: {
    label: "LIVE",
    dot:    "bg-emerald-400",
    text:   "text-emerald-300",
    border: "border-emerald-500/30",
    bg:     "bg-emerald-500/10",
  },
  error: {
    label: "ERR",
    dot:    "bg-red-400",
    text:   "text-red-300",
    border: "border-red-500/30",
    bg:     "bg-red-500/10",
  },
  payment: {
    label: "PAY",
    dot:    "bg-teal-400",
    text:   "text-teal-300",
    border: "border-teal-500/30",
    bg:     "bg-teal-500/10",
  },
  done: {
    label: "DONE",
    dot:    "bg-gray-400",
    text:   "text-gray-400",
    border: "border-gray-600/30",
    bg:     "bg-gray-800/40",
  },
};

export function StatusBadge({ type, pulse }: Props) {
  const c = CONFIG[type] ?? CONFIG.thought;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md",
        "text-[10px] font-mono font-bold tracking-widest shrink-0",
        "border transition-all duration-300",
        c.text, c.border, c.bg,
      )}
    >
      <span className={cn("relative w-1.5 h-1.5 rounded-full shrink-0", c.dot)}>
        {pulse && (
          <span
            className={cn(
              "absolute inset-0 rounded-full animate-ping opacity-75",
              c.dot,
            )}
          />
        )}
      </span>
      {c.label}
    </span>
  );
}

import { Scale } from "lucide-react";

/** Shows which house rules changed an assistant output, as the assistant reported them. */
export function RulesApplied({ rules }: { rules: string[] | undefined }) {
  if (!rules?.length) return null;
  return (
    <div className="vl-rules-applied" data-testid="rules-applied">
      {rules.map((r) => (
        <span key={r} className="vl-rule-chip" title="A house rule changed what the assistant wrote">
          <Scale size={11} aria-hidden /> House rule applied: {r}
        </span>
      ))}
    </div>
  );
}

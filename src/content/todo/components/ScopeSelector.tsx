import { SCOPES, SCOPE_LABELS, type Scope } from "../dateRange";

interface Props {
  scope: Scope;
  onScope: (scope: Scope) => void;
}

export default function ScopeSelector({ scope, onScope }: Props) {
  return (
    <div className="blms-scopeselector" role="group" aria-label="Date scope">
      {SCOPES.map((option) => (
        <button
          key={option}
          type="button"
          className={
            "blms-scopeselector__option" +
            (option === scope ? " option--selected" : "")
          }
          aria-pressed={option === scope}
          onClick={() => onScope(option)}
        >
          {SCOPE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}

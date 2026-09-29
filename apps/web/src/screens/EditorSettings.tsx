import type { EditorPreferences } from "@vellum/core";
import { SettingsLayout } from "../components/SettingsLayout.js";
import { FONT_STACK, MEASURE, usePreferences } from "../state/preferences.js";

function Choice<K extends keyof EditorPreferences>(props: {
  label: string;
  field: K;
  options: Array<{ value: EditorPreferences[K]; label: string }>;
}) {
  const value = usePreferences((s) => s.prefs[props.field]);
  const update = usePreferences((s) => s.update);
  return (
    <fieldset className="vl-choice">
      <legend>{props.label}</legend>
      <div className="vl-segmented" role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => void update({ [props.field]: o.value } as Partial<EditorPreferences>)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function EditorSettingsPage() {
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  return (
    <SettingsLayout title="Editor">
      <p className="vl-lede">
        How the page looks while you write. These settings are for you, on this device.
      </p>
      <section className="vl-card" aria-labelledby="look-h">
        <h2 id="look-h">Page</h2>
        <Choice
          label="Font"
          field="font"
          options={[
            { value: "serif", label: "Serif" },
            { value: "sans", label: "Sans" },
            { value: "mono", label: "Mono" },
          ]}
        />
        <Choice
          label="Line length"
          field="measure"
          options={[
            { value: "narrow", label: "Narrow" },
            { value: "medium", label: "Medium" },
            { value: "wide", label: "Wide" },
          ]}
        />
        <Choice
          label="Theme"
          field="theme"
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
        <label className="vl-switch">
          <input
            type="checkbox"
            checked={prefs.spellcheck}
            onChange={(e) => void update({ spellcheck: e.target.checked })}
          />
          <span>
            Check spelling
            <small className="vl-muted">Uses your browser’s or system’s spellchecker.</small>
          </span>
        </label>
      </section>
      <section className="vl-card" aria-labelledby="preview-h">
        <h2 id="preview-h">Preview</h2>
        <p
          className="vl-pref-preview"
          data-testid="pref-preview"
          style={{ fontFamily: FONT_STACK[prefs.font], maxWidth: MEASURE[prefs.measure] }}
        >
          It was the kind of morning that asks nothing of you. The kettle ticked as it cooled, and somewhere
          below the window a bicycle bell rang twice, as if unsure whether anyone was listening.
        </p>
      </section>
    </SettingsLayout>
  );
}

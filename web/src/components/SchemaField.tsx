import { useState } from "react";

import { OptionSchema } from "../types";

export interface SchemaFieldProps {
  name: string;
  schema: OptionSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  // Defaults to `name`; pass one when several fields named e.g. "name" render
  // on the same page at once, so their <label for> targets stay unique.
  id?: string;
}

function JSONInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2) ?? "");
  const [invalid, setInvalid] = useState(false);

  return (
    <>
      <textarea
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);

          try {
            onChange(next.trim() === "" ? undefined : JSON.parse(next));
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid && (
        <span className="field-error-message">
          Not valid JSON -- keeping the last valid value.
        </span>
      )}
    </>
  );
}

export default function SchemaField({
  name,
  schema,
  value,
  onChange,
  error,
  id = name,
}: SchemaFieldProps) {
  // A checkbox reads left-to-right as "[x] label", not the label-above-input
  // stack every other field type uses, so it gets its own layout entirely.
  if (schema.type === "boolean")
    return (
      <div className={`field field-checkbox${error ? " field-error" : ""}`}>
        <label htmlFor={id} className="checkbox-label">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{name}</span>
        </label>
        <span className="hint">{schema.description}</span>
        {error && <span className="field-error-message">{error}</span>}
      </div>
    );

  return (
    <div className={`field${error ? " field-error" : ""}`}>
      <label htmlFor={id}>
        <span>
          {name}
          {schema.required ? " *" : ""}
        </span>
        {schema.unit && <span className="hint">{schema.unit}</span>}
      </label>

      {renderInput()}

      {schema.interpolated && (
        <span className="hint">supports {"${...}"} interpolation</span>
      )}
      <span className="hint">{schema.description}</span>
      {error && <span className="field-error-message">{error}</span>}
    </div>
  );

  function renderInput() {
    if (schema.type === "string" && schema.enum)
      return (
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" disabled>
            select...
          </option>
          {schema.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );

    if (schema.type === "string")
      return (
        <input
          id={id}
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    if (schema.type === "number")
      return (
        <input
          id={id}
          type="number"
          min={schema.min}
          max={schema.max}
          step={schema.integer ? 1 : "any"}
          value={typeof value === "number" ? value : ""}
          onChange={(event) => {
            const next = event.target.valueAsNumber;
            onChange(Number.isNaN(next) ? undefined : next);
          }}
        />
      );

    // object, array, and any: arbitrary shapes (transform:merge's `sources`,
    // output:mqtt's `topics`, ...) are edited as JSON.
    return <JSONInput value={value} onChange={onChange} />;
  }
}

import { useState } from "react";
import ReactSimpleCodeEditor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-json";

// react-simple-code-editor ships a CJS build whose default export Vite's
// dependency pre-bundler does not always unwrap -- ReactSimpleCodeEditor can
// come through as the module object ({ default: Editor }) instead of Editor
// itself, which renders as "Element type is invalid: ... got: object."
const Editor =
  (
    ReactSimpleCodeEditor as unknown as {
      default?: typeof ReactSimpleCodeEditor;
    }
  ).default ?? ReactSimpleCodeEditor;

export interface StepJsonEditorProps {
  value: unknown;
  onChange: (value: unknown) => void;
}

export default function StepJsonEditor({
  value,
  onChange,
}: StepJsonEditorProps) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);

  return (
    <div className="json-editor">
      <Editor
        value={text}
        onValueChange={(next) => {
          setText(next);
          try {
            onChange(JSON.parse(next));
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
        highlight={(code) =>
          Prism.highlight(code, Prism.languages.json, "json")
        }
        padding={10}
        textareaClassName="json-editor-textarea"
        preClassName="json-editor-pre"
        style={{
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
          lineHeight: 1.5,
        }}
      />
      {invalid && (
        <span className="field-error-message">
          Not valid JSON -- keeping the last valid value.
        </span>
      )}
    </div>
  );
}

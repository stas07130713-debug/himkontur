import { useEffect, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & Readonly<{
  value: number;
  onValueChange: (value: number) => void;
  format?: (value: number) => string;
}>;

export function EditableNumberInput({ value, onValueChange, format = String, onBlur, ...props }: Props) {
  const [text, setText] = useState(() => format(value));

  useEffect(() => {
    // A blank field does not change the model yet, so it remains blank while
    // the operator is replacing its contents. Any real model update (buttons,
    // weather, preset restoration) must be reflected immediately.
    setText(format(value));
  }, [format, value]);

  return <input
    {...props}
    type="number"
    value={text}
    onChange={(event) => {
      const next = event.currentTarget.value;
      setText(next);
      if (next !== '' && Number.isFinite(event.currentTarget.valueAsNumber)) onValueChange(event.currentTarget.valueAsNumber);
    }}
    onBlur={(event) => {
      if (event.currentTarget.value === '') setText(format(value));
      else if (Number.isFinite(event.currentTarget.valueAsNumber)) setText(format(event.currentTarget.valueAsNumber));
      onBlur?.(event);
    }}
  />;
}

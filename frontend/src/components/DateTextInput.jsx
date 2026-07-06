import { useEffect, useState } from "react";
import { displayDateToIso, isoToDisplayDate } from "../utils/dateFormat.js";

export default function DateTextInput({ value = "", onChange, ...props }) {
  const [text, setText] = useState(isoToDisplayDate(value));

  useEffect(() => {
    setText(isoToDisplayDate(value));
  }, [value]);

  const update = (nextText) => {
    setText(nextText);
    if (!nextText.trim()) {
      onChange("");
      return;
    }
    const iso = displayDateToIso(nextText);
    if (iso) onChange(iso);
  };

  const normalize = () => {
    const iso = displayDateToIso(text);
    if (iso) {
      onChange(iso);
      setText(isoToDisplayDate(iso));
    } else {
      setText(isoToDisplayDate(value));
    }
  };

  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      placeholder="dd/mm/yyyy"
      value={text}
      onChange={(e) => update(e.target.value)}
      onBlur={normalize}
    />
  );
}

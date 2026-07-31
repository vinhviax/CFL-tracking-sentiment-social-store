import { useEffect, useRef, useState } from "react";
import { displayDateToIso, isoToDisplayDate } from "../utils/dateFormat.js";

export default function DateTextInput({ value = "", onChange, className = "", disabled = false, ...props }) {
  const [text, setText] = useState(isoToDisplayDate(value));
  const pickerRef = useRef(null);

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

  const openPicker = () => {
    const picker = pickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
      return;
    }
    picker.focus();
    picker.click();
  };

  return (
    <div className={`date-input ${className}`.trim()}>
      <input
        {...props}
        disabled={disabled}
        className="date-input-text"
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        value={text}
        onChange={(e) => update(e.target.value)}
        onBlur={normalize}
      />
      <input
        ref={pickerRef}
        className="date-native-picker"
        type="date"
        value={value || ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
      />
      {/* The calendar button needs disabling too, otherwise it still opens the native
          picker over a field the caller has locked. */}
      <button
        className="date-picker-button"
        type="button"
        aria-label="Chọn ngày"
        title="Chọn ngày"
        disabled={disabled}
        onClick={openPicker}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M4 10h16" />
        </svg>
      </button>
    </div>
  );
}

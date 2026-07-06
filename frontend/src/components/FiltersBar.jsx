import DateTextInput from "./DateTextInput.jsx";

const SOURCES = [
  { value: "", label: "Tất cả nguồn" },
  { value: "store", label: "Store" },
  { value: "fb_page", label: "Fanpage" },
  { value: "fb_group_csv", label: "Group (CSV)" },
];

export default function FiltersBar({ filters, onChange, meta, extra }) {
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value });
  const setDate = (key) => (value) => onChange({ ...filters, [key]: value });

  return (
    <div className="filters-bar">
      <label>
        Từ ngày
        <DateTextInput value={filters.from || ""} onChange={setDate("from")} />
      </label>
      <label>
        Đến ngày
        <DateTextInput value={filters.to || ""} onChange={setDate("to")} />
      </label>
      <label>
        Nguồn
        <select value={filters.source || ""} onChange={set("source")}>
          {SOURCES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </label>
      {meta && (
        <label>
          Chủ đề
          <select value={filters.topic || ""} onChange={set("topic")}>
            <option value="">Tất cả chủ đề</option>
            {Object.entries(meta.topics).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
      )}
      {meta && (
        <label>
          Sentiment
          <select value={filters.sentiment || ""} onChange={set("sentiment")}>
            <option value="">Tất cả</option>
            {Object.entries(meta.sentiments).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
      )}
      {extra}
    </div>
  );
}

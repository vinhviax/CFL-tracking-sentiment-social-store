function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseDateParts(value) {
  if (!value) return null;
  const text = String(value).trim();
  let day;
  let month;
  let year;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const display = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (!display) return null;
    day = Number(display[1]);
    month = Number(display[2]);
    year = Number(display[3]);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { day, month, year };
}

export function formatDisplayDate(value) {
  const parts = parseDateParts(value);
  if (!parts) return value || "";
  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
}

export function formatDisplayDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return [
    `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`,
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
  ].join(" ");
}

export function isoToDisplayDate(value) {
  return formatDisplayDate(value);
}

export function displayDateToIso(value) {
  const parts = parseDateParts(value);
  if (!parts) return null;
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

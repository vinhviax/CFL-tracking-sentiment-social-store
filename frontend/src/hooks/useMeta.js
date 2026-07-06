import { useEffect, useState } from "react";
import { getMeta } from "../api/client.js";

export default function useMeta() {
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getMeta()
      .then(setMeta)
      .catch((e) => setError(e.message || "Không tải được metadata"));
  }, []);

  return { meta, error };
}

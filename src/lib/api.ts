import { supabase } from "@/integrations/supabase/client";

export async function ingestTexts(texts: string[], source: string) {
  const session = (await supabase.auth.getSession()).data.session;

  const res = await fetch("http://127.0.0.1:8000/api/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ texts, source }),
  });

  return res.json();
}

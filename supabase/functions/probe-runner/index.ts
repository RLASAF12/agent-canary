import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

function extractResponseText(data: unknown): string {
  if (!data || typeof data !== "object") return JSON.stringify(data)
  const d = data as Record<string, unknown>
  // OpenAI format: choices[0].message.content
  if (Array.isArray(d.choices) && d.choices.length > 0) {
    const choice = d.choices[0] as Record<string, unknown>
    if (choice.message && typeof (choice.message as Record<string, unknown>).content === "string") {
      return (choice.message as Record<string, unknown>).content as string
    }
  }
  // Anthropic format: content[0].text
  if (Array.isArray(d.content) && d.content.length > 0) {
    const c = d.content[0] as Record<string, unknown>
    if (typeof c.text === "string") return c.text
  }
  // Generic fallbacks
  if (typeof d.text === "string") return d.text
  if (typeof d.response === "string") return d.response
  if (typeof d.message === "string") return d.message
  return JSON.stringify(data)
}

Deno.serve(async (req: Request) => {
  // Accept GET or POST (pg_cron triggers via GET, manual via POST)
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const ran_at = new Date().toISOString()
  const results: Array<{ question_id: string; canary: string; status: string; latency_ms: number }> = []

  try {
    // Fetch all active probe questions with canary info
    const { data: questions, error: qErr } = await sb
      .from("probe_questions")
      .select("*, canaries!inner(id, name, endpoint_url, auth_header, request_template, is_active)")
      .eq("is_active", true)
      .eq("canaries.is_active", true)

    if (qErr) throw new Error(`Failed to fetch questions: ${qErr.message}`)
    if (!questions || questions.length === 0) {
      return new Response(JSON.stringify({ processed: 0, results: [], ran_at }), {
        headers: { "Content-Type": "application/json" }
      })
    }

    for (const q of questions) {
      const canary = q.canaries
      const start = Date.now()
      let status: "pass" | "drift" | "error" = "error"
      let responseText = ""
      let driftReason: string | null = null

      try {
        // Build request body
        let body: Record<string, unknown> = { input: q.question }
        if (canary.request_template) {
          body = { ...canary.request_template, input: q.question }
        }

        const headers: Record<string, string> = { "Content-Type": "application/json" }
        if (canary.auth_header) {
          const [key, ...val] = canary.auth_header.split(": ")
          if (key && val.length) headers[key] = val.join(": ")
        }

        const resp = await fetch(canary.endpoint_url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000)
        })

        const latency_ms = Date.now() - start
        const data = await resp.json()
        responseText = extractResponseText(data)

        // Check baseline keywords
        if (q.baseline_keywords && q.baseline_keywords.length > 0) {
          const lowerResponse = responseText.toLowerCase()
          const missingKeywords = q.baseline_keywords.filter(
            (kw: string) => !lowerResponse.includes(kw.toLowerCase())
          )
          if (missingKeywords.length > 0) {
            status = "drift"
            driftReason = `Missing expected keywords: ${missingKeywords.join(", ")}`
          } else {
            status = "pass"
          }
        } else {
          // No keywords defined — pass if we got a response
          status = resp.ok ? "pass" : "error"
          if (!resp.ok) driftReason = `HTTP ${resp.status}: ${resp.statusText}`
        }

        // Insert probe run
        const { data: run, error: runErr } = await sb
          .from("probe_runs")
          .insert({
            canary_id: canary.id,
            question_id: q.id,
            response: responseText.slice(0, 2000),
            status,
            drift_reason: driftReason,
            latency_ms
          })
          .select()
          .single()

        if (runErr) console.error("Failed to insert probe run:", runErr)

        // Create alert if drift or error
        if ((status === "drift" || status === "error") && run) {
          const alertMsg = status === "drift"
            ? `[DRIFT] ${canary.name}: "${q.question.slice(0, 60)}" — ${driftReason}`
            : `[ERROR] ${canary.name}: Failed to get valid response`

          await sb.from("alerts").insert({
            canary_id: canary.id,
            run_id: run.id,
            message: alertMsg
          })

          // Fire webhook if configured
          if (canary.webhook_url) {
            try {
              await fetch(canary.webhook_url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ alert: alertMsg, canary: canary.name, status, ran_at })
              })
            } catch (e) {
              console.error("Webhook failed:", e)
            }
          }
        }

        results.push({ question_id: q.id, canary: canary.name, status, latency_ms })
      } catch (e) {
        const latency_ms = Date.now() - start
        console.error(`Error probing ${canary.name}:`, e)

        const { data: run } = await sb
          .from("probe_runs")
          .insert({
            canary_id: canary.id,
            question_id: q.id,
            response: null,
            status: "error",
            drift_reason: e instanceof Error ? e.message : "Unknown error",
            latency_ms
          })
          .select()
          .single()

        if (run) {
          await sb.from("alerts").insert({
            canary_id: canary.id,
            run_id: run.id,
            message: `[ERROR] ${canary.name}: ${e instanceof Error ? e.message : "Unknown error"}`
          })
        }

        results.push({ question_id: q.id, canary: canary.name, status: "error", latency_ms })
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results, ran_at }), {
      headers: { "Content-Type": "application/json" }
    })
  } catch (e) {
    console.error("Fatal probe-runner error:", e)
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", ran_at }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
})

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) }; }

  const { base64Image, mediaType } = body;
  if (!base64Image || !mediaType) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing base64Image or mediaType" }) };
  }

  const prompt = `You are analyzing a flight search screenshot. Extract flight information and return ONLY a JSON object with these fields (use null for anything not visible):
{
  "route": "origin → destination (e.g. AUH → NRT)",
  "airline": "airline name and flight number if visible",
  "flightDate": "YYYY-MM-DD format if visible, else null",
  "cabin": "Economy|Premium Economy|Business|First",
  "cashPrice": "numeric only, no currency symbol",
  "cashCurrency": "3-letter currency code e.g. EUR, USD, AED",
  "milesPrice": "numeric only if miles price shown, else null",
  "milesProgram": "miles program name if shown, else null",
  "notes": "any other relevant info like stops, duration, taxes included"
}
Return ONLY the JSON object, no explanation.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: err }) };
    }

    const data = await res.json();
    const text = data.content[0].text.trim().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(text);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed)
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

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

  const { images } = body; // array of { base64Image, mediaType }
  if (!images || !images.length) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing images array" }) };
  }

  const prompt = `You are analyzing one or more flight search screenshots. They may show:
- A single one-way flight
- Outbound + return legs of a round trip (shown on separate screens)
- Multiple different flight options

Analyze ALL screenshots together and return ONLY a JSON array where each element is one logical flight booking. If screenshots show outbound + return of the same trip, merge them into ONE entry with a round-trip route. If they show different/independent flights, return multiple entries.

Each entry must have these fields (use null for anything not visible):
{
  "route": "full route e.g. AUH → DPS → AUH for round trip, or AUH → DPS for one-way",
  "airline": "airline name(s) and flight number(s), e.g. Etihad EY476 / EY477",
  "outboundDate": "YYYY-MM-DD of outbound/first flight",
  "returnDate": "YYYY-MM-DD of return flight if round trip, else null",
  "cabin": "Economy|Premium Economy|Business|First",
  "cashPriceTotal": "total numeric price for all pax combined, no currency symbol",
  "cashCurrency": "3-letter currency code e.g. AED, EUR, USD",
  "pax": "number of passengers as integer",
  "milesPrice": "total miles if shown, numeric only, else null",
  "milesProgram": "miles program name if shown, else null",
  "isRoundTrip": true or false,
  "notes": "other useful info: duration, stops, taxes, fare class, etc."
}

Return ONLY the JSON array, no explanation, no markdown.`;

  // Build content array with all images + prompt
  const content = [
    ...images.map(img => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.base64Image }
    })),
    { type: "text", text: prompt }
  ];

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
        max_tokens: 1000,
        messages: [{ role: "user", content }]
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

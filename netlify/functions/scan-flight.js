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

  const { images } = body;
  if (!images || !images.length) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing images array" }) };
  }

  const prompt = `You are analyzing one or more flight search screenshots. Extract ALL flight options visible across ALL screenshots.

For each unique combination of route + cabin class + price, create a separate entry. For example if you see Economy and Business prices for the same route, return TWO entries.

If screenshots show outbound + return legs of the same trip, treat them as a round trip and merge into one entry per cabin class.

Return ONLY a JSON array. Each element:
{
  "route": "full route e.g. AUH → DPS → AUH for round trip",
  "airline": "airline name(s) and flight number(s)",
  "outboundDate": "YYYY-MM-DD or null",
  "returnDate": "YYYY-MM-DD or null",
  "cabin": "Economy|Premium Economy|Business|First",
  "cashPriceTotal": "total numeric price for all pax, no currency symbol, or null",
  "cashCurrency": "3-letter code e.g. AED",
  "pax": integer number of passengers,
  "milesPrice": "total miles numeric or null",
  "milesProgram": "program name or null",
  "isRoundTrip": true or false,
  "notes": "duration, stops, taxes, fare class, any extra info"
}

Return ONLY the JSON array, no explanation, no markdown.`;

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
        max_tokens: 2000,
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

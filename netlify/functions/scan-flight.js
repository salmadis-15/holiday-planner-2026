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
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON: " + e.message }) }; }

  const { images, currentYear } = body;
  if (!images || !images.length) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing images array" }) };
  }

  const year = currentYear || 2026;

  const prompt = `You are analyzing one or more flight search screenshots. Extract ALL flight options visible across ALL screenshots.

For each unique combination of route + cabin class + price type, create a separate entry. For example if you see Economy and Business prices, return TWO entries. If you see both cash price AND miles+taxes price for the same cabin, return TWO entries (one cash, one miles).

If screenshots show outbound + return legs of the same trip, treat them as a round trip and merge into one entry per cabin class.

CRITICAL for dates: The current year is ${year}. When you see dates like "26 May" or "01 Jun" without a year, ALWAYS use ${year}. NEVER use 2020 or any other year unless explicitly shown.

For miles redemptions: extract milesPrice (total miles all pax), milesTaxTotal (total cash taxes all pax), milesTaxCurrency, set cashPriceTotal to null.
For cash bookings: extract cashPriceTotal (total all pax), set milesPrice to null.

Return ONLY a JSON array. Each element:
{
  "route": "e.g. AUH -> DPS -> AUH",
  "airline": "airline and flight numbers",
  "outboundDate": "YYYY-MM-DD",
  "returnDate": "YYYY-MM-DD or null",
  "cabin": "Economy|Premium Economy|Business|First",
  "cashPriceTotal": numeric or null,
  "cashCurrency": "AED",
  "pax": integer,
  "milesPrice": numeric or null,
  "milesTaxTotal": numeric or null,
  "milesTaxCurrency": "AED",
  "milesProgram": "program name or null",
  "isRoundTrip": true or false,
  "notes": "brief summary"
}

Return ONLY the JSON array, no explanation, no markdown backticks.`;

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

    const responseText = await res.text();

    if (!res.ok) {
      console.error("Anthropic API error:", res.status, responseText);
      return { statusCode: res.status, body: JSON.stringify({ error: "Anthropic API error: " + responseText }) };
    }

    const data = JSON.parse(responseText);
    const text = data.content[0].text.trim().replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch(e) {
      console.error("JSON parse error:", e.message, "Raw text:", text);
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to parse AI response: " + text.slice(0, 200) }) };
    }

    // Fix wrong years
    const fixDate = (d) => {
      if (!d) return d;
      const match = d.match(/^(\d{4})-(\d{2}-\d{2})$/);
      if (!match) return d;
      const y = parseInt(match[1]);
      if (y !== year && y !== year + 1) return `${year}-${match[2]}`;
      return d;
    };

    parsed = parsed.map(f => ({
      ...f,
      outboundDate: fixDate(f.outboundDate),
      returnDate: fixDate(f.returnDate),
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    console.error("Function error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

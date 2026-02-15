// Vercelサーバーレス関数: クライアントサイドのAPIキー露出を防ぎます。
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { type, query, prompt } = JSON.parse(req.body);
    const apiKey = process.env.GEMINI_API_KEY; 

    // リクエストタイプに応じたプロンプトの設定
    let systemInstruction = "";
    let userMessage = "";

    if (type === 'market_data') {
        systemInstruction = `
            今日現在の最新市場データを調査し、以下のJSON形式でのみ回答してください。
            {
                "fgValue": 数値(0-100),
                "fgLabel": "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed",
                "usdjpy": "数値",
                "usdjpyChange": "前日比(%)",
                "sp500": "数値",
                "nikkei": "数値"
            }
        `;
        userMessage = "最新のFear & Greed Index、ドル円、S&P500、日経平均を教えてください。";
    } else {
        systemInstruction = prompt; // index.htmlから渡された詳細プロンプトを使用
        userMessage = `分析対象: ${query}`;
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userMessage }] }],
                systemInstruction: { parts: [{ text: systemInstruction }] },
                tools: [{ "google_search": {} }],
                generationConfig: { 
                    responseMimeType: type === 'market_data' ? "application/json" : "text/plain" 
                }
            })
        });

        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (type === 'market_data') {
            res.status(200).json(JSON.parse(result));
        } else {
            res.status(200).json({ text: result });
        }
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: 'AIとの通信に失敗しました。APIキーが設定されているか確認してください。' });
    }
}

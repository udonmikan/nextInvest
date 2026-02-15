// api/analyze.js - 全機能統合・エラー対策版
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'APIキーが設定されていません。Vercelの環境変数を確認してください。' });
    }

    try {
        // Vercelの仕様に合わせ、bodyを安全に取得
        const bodyData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { type, query, prompt: systemPrompt } = bodyData;

        let systemInstruction = "";
        let userMessage = "";
        let isJsonResponse = false;

        // リクエストタイプ別の処理
        if (type === 'market_data') {
            systemInstruction = `
                今日現在の最新市場データを調査し、以下のJSON形式でのみ回答してください。余計な文章は不要です。
                {
                    "fgValue": 0-100の数値,
                    "fgLabel": "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed",
                    "usdjpy": "現在のレート",
                    "usdjpyChange": "前日比",
                    "sp500": "現在の数値",
                    "nikkei": "現在の数値"
                }
            `;
            userMessage = "最新の市場指標を教えて。";
            isJsonResponse = true;
        } else if (type === 'ranking') {
            systemInstruction = `
                今日現在の日本株配当利回りランキング上位3位を調査し、
                必ず以下のHTML形式（glass-cardクラスを使用）のみで出力してください。優待情報は含めないでください。
                <div class="glass-card p-8 relative overflow-hidden">
                    <div class="text-blue-400 font-bold mb-2">RANK #順位</div>
                    <h3 class="text-xl font-bold mb-1">銘柄名</h3>
                    <p class="text-sm text-gray-400 mb-4">企業の特徴解説</p>
                    <div class="text-2xl font-black text-emerald-400">利回り 0.0%</div>
                </div>
            `;
            userMessage = "日本株の高配当ランキング上位3位を教えて。";
        } else {
            systemInstruction = systemPrompt || "プロの投資アナリストとして回答してください。";
            userMessage = `分析対象: ${query}`;
        }

        // Gemini API呼び出し
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userMessage }] }],
                systemInstruction: { parts: [{ text: systemInstruction }] },
                tools: [{ "google_search": {} }],
                generationConfig: { 
                    responseMimeType: isJsonResponse ? "application/json" : "text/plain" 
                }
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || 'API通信エラー');
        }

        const apiData = await response.json();
        let resultText = apiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

        // Markdownの装飾（ ```html や ```json ）が含まれている場合の除去
        resultText = resultText.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();

        if (isJsonResponse) {
            res.status(200).json(JSON.parse(resultText));
        } else {
            res.status(200).json({ text: resultText });
        }
    } catch (error) {
        console.error("Handler Error:", error.message);
        res.status(500).json({ error: error.message });
    }
}
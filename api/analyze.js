// api/analyze.js - Vercel Serverless Function
export default async function handler(req, res) {
    // 1. POST以外のアクセスを拒否
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 2. APIキーの存在チェック
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("GEMINI_API_KEY is not configured.");
        return res.status(500).json({ error: 'APIキーが設定されていません。Vercelの環境変数を確認してください。' });
    }

    try {
        // 3. bodyの安全な取得 (Vercelの自動パース対応)
        // もしすでにオブジェクトならそのまま使い、文字列ならパースする
        let bodyData;
        if (typeof req.body === 'string') {
            try {
                bodyData = JSON.parse(req.body);
            } catch (e) {
                console.error("Body parse error:", e);
                return res.status(400).json({ error: 'Invalid JSON format in request body' });
            }
        } else {
            bodyData = req.body;
        }

        const { type, query, prompt: systemPrompt } = bodyData;

        // 4. Gemini API用のプロンプト構築
        let systemInstruction = "";
        let userMessage = "";

        if (type === 'market_data') {
            systemInstruction = `
                現在（2026年時点）の最新の市場データを調査し、以下のJSON形式でのみ回答してください。
                解説などは一切不要です。純粋なJSONのみを返してください。
                {
                    "fgValue": 0から100の数値,
                    "fgLabel": "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed",
                    "usdjpy": "現在のドル円レート(例: 149.20)",
                    "usdjpyChange": "前日比(例: +0.45%)",
                    "sp500": "現在のS&P500値",
                    "nikkei": "現在の日経平均値"
                }
            `;
            userMessage = "最新のFear & Greed Index、ドル円為替、S&P500、日経平均の現在値を教えて。";
        } else {
            systemInstruction = systemPrompt || "あなたは優秀な投資アナリストです。日本語で回答してください。";
            userMessage = `対象: ${query}`;
        }

        // 5. Gemini API (Flash 2.5) を呼び出し
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
        
        const response = await fetch(geminiUrl, {
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

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Gemini API Error Response:", errorText);
            return res.status(response.status).json({ error: 'Gemini APIへの通信に失敗しました。' });
        }

        const result = await response.json();
        let contentText = result.candidates?.[0]?.content?.parts?.[0]?.text;

        // 6. 結果の返却
        if (type === 'market_data') {
            // AIがたまにコードブロックなどで囲ってしまう場合があるため、JSON部分だけを抽出するケア
            if (contentText.includes('```json')) {
                contentText = contentText.replace(/```json|```/g, '').trim();
            }
            try {
                const jsonResponse = JSON.parse(contentText);
                return res.status(200).json(jsonResponse);
            } catch (e) {
                console.error("JSON parsing error from AI response:", contentText);
                return res.status(500).json({ error: 'AIからのデータ形式が不正です。' });
            }
        } else {
            return res.status(200).json({ text: contentText });
        }

    } catch (error) {
        console.error("Function Handler Error:", error);
        return res.status(500).json({ error: 'サーバー内部でエラーが発生しました。' });
    }
}
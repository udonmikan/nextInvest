// api/analyze.js - 全機能統合・エラー対策版
export default async function handler(req, res) {
    // 1. POSTメソッド以外のアクセスを拒否
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 2. 環境変数が設定されているか厳密にチェック
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
        console.error("Critical Error: GEMINI_API_KEY is not set in environment variables.");
        return res.status(500).json({ 
            error: 'APIキーがサーバーに設定されていません。Vercelの Settings > Environment Variables で GEMINI_API_KEY を正しく設定し、再デプロイしてください。' 
        });
    }

    try {
        // 3. bodyの解析（Vercelの自動解析に対応しつつ安全に処理）
        let bodyData;
        try {
            bodyData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } catch (e) {
            console.error("Invalid JSON payload:", req.body);
            return res.status(400).json({ error: 'リクエストのデータ形式が正しくありません。' });
        }

        const { type, query, prompt: systemPrompt } = bodyData;

        // 4. リクエスト内容の構築
        let systemInstruction = "";
        let userMessage = "";
        let isJsonResponse = false;

        if (type === 'market_data') {
            systemInstruction = `
                今日現在の最新市場データを調査し、以下のJSON形式でのみ回答してください。解説やMarkdownのタグ( \`\`\` )は一切不要です。
                {
                    "fgValue": 0-100の数値,
                    "fgLabel": "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed",
                    "usdjpy": "現在のレート",
                    "usdjpyChange": "前日比",
                    "sp500": "現在の数値",
                    "nikkei": "現在の数値"
                }
            `;
            userMessage = "今日のFear & Greed Index、ドル円為替、S&P500、日経平均の最新値を教えてください。";
            isJsonResponse = true;
        } else if (type === 'ranking') {
            systemInstruction = `
                今日現在の日本株高配当利回りランキング上位3位を調査し、必ず以下のHTML形式（glass-cardクラスを使用）のみで出力してください。Markdownタグ( \`\`\`html )などは含めないでください。
                <div class="glass-card p-8 relative overflow-hidden">
                    <div class="text-blue-400 font-bold mb-2">RANK #順位</div>
                    <h3 class="text-xl font-bold mb-1">銘柄名</h3>
                    <p class="text-sm text-gray-400 mb-4">企業の特徴解説</p>
                    <div class="text-2xl font-black text-emerald-400">利回り 0.0%</div>
                </div>
            `;
            userMessage = "日本株の高配当ランキング上位3位を教えて。";
        } else {
            systemInstruction = systemPrompt || "プロの投資アナリストとして、最新のニュースを基に日本語で詳しく回答してください。";
            userMessage = query ? `分析対象: ${query}` : "現在の市場トレンドについて教えてください。";
        }

        // 5. Gemini API (gemini-2.5-flash-preview-09-2025) を呼び出し
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
        
        const response = await fetch(apiUrl, {
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

        const apiData = await response.json();

        if (!response.ok) {
            console.error("Gemini API Error:", apiData);
            return res.status(response.status).json({ 
                error: apiData.error?.message || 'Gemini APIとの通信に失敗しました。' 
            });
        }

        let resultText = apiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

        // 6. レスポンスのクリーンアップ（AIがMarkdownで出力してしまった場合の対策）
        // 特にHTMLやJSONを期待する場合に不要な装飾を除去する
        resultText = resultText.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();

        if (isJsonResponse) {
            try {
                // JSONとしてパースできるか確認
                const jsonResult = JSON.parse(resultText);
                res.status(200).json(jsonResult);
            } catch (e) {
                console.error("JSON Parse Error from AI response:", resultText);
                res.status(500).json({ error: 'AIから取得したデータの解析に失敗しました。' });
            }
        } else {
            res.status(200).json({ text: resultText });
        }

    } catch (error) {
        console.error("Serverless Function Crash:", error);
        res.status(500).json({ error: `内部エラーが発生しました: ${error.message}` });
    }
}
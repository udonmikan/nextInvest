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
            userMessage = "今日の市場の主要指標を教えてください。";
            isJsonResponse = true;
        } else if (type === 'dividend_ranking') {
            systemInstruction = `
                現在、日本株で配当利回りが高い銘柄の上位10社を調査してください。
                結果は必ず、見やすいHTMLテーブル形式（<table>タグ）で出力してください。
                各行には「順位」「銘柄名・コード」「1株配当(予想)」「配当利回り」を含めてください。
                スタイルはTailwind CSSのクラス（例: text-left, p-3, border-b border-white/10など）を使用して装飾してください。
            `;
            userMessage = "最新の日本株高配当ランキングTOP10を作成してください。";
        } else if (type === 'yutai_list') {
            systemInstruction = `
                今月（現在の日付に基づいた月）が権利確定月となっている、日本株の人気株主優待銘柄を調査してください。
                結果は、銘柄名、優待内容、権利確定日がわかるように、HTMLのリスト形式（またはグリッド形式）で出力してください。
                各銘柄を <div class="p-4 border-b border-white/5"> で囲み、魅力的な装飾を施してください。
            `;
            userMessage = "今月の株主優待銘柄一覧を教えてください。";
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

        // 6. レスポンスのクリーンアップ
        resultText = resultText.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();

        if (isJsonResponse) {
            try {
                const jsonResult = JSON.parse(resultText);
                res.status(200).json(jsonResult);
            } catch (e) {
                res.status(500).json({ error: 'データの解析に失敗しました。' });
            }
        } else {
            res.status(200).json({ text: resultText });
        }

    } catch (error) {
        console.error("Serverless Function Crash:", error);
        res.status(500).json({ error: `内部エラーが発生しました: ${error.message}` });
    }
}
// api/analyze.js - 全機能統合・自動再試行機能付き
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
        return res.status(500).json({ 
            error: 'APIキーが設定されていません。Vercelの環境変数 GEMINI_API_KEY を確認してください。' 
        });
    }

    try {
        const bodyData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { type, query, prompt: systemPrompt } = bodyData;

        let systemInstruction = "";
        let userMessage = "";
        let isJsonResponse = false;

        if (type === 'market_data') {
            systemInstruction = `
                今日現在の最新市場データを調査し、以下のJSON形式でのみ回答してください。
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
                結果は必ず、見やすいHTMLテーブル形式で出力してください。
                各行には「順位」「銘柄名・コード」「1株配当(予想)」「配当利回り」を含めてください。
                スタイルはTailwind CSSを使用して装飾してください。
            `;
            userMessage = "最新の日本株高配当ランキングTOP10を作成してください。";
        } else if (type === 'yutai_list') {
            systemInstruction = `
                今月が権利確定月となっている、日本株の人気株主優待銘柄を調査してください。
                銘柄名、優待内容、権利確定日がわかるようにHTMLで出力してください。
            `;
            userMessage = "今月の株主優待銘柄一覧を教えてください。";
        } else {
            systemInstruction = systemPrompt || "プロの投資アナリストとして日本語で回答してください。";
            userMessage = query ? `分析対象: ${query}` : "現在の市場トレンドについて教えてください。";
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
        
        // --- 自動再試行（指数バックオフ）の実装 ---
        let response;
        let lastError;
        const maxRetries = 5;
        const retryDelays = [1000, 2000, 4000, 8000, 16000];

        for (let i = 0; i <= maxRetries; i++) {
            response = await fetch(apiUrl, {
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

            if (response.ok) break;

            const errData = await response.json().catch(() => ({}));
            lastError = errData.error?.message || 'API通信エラー';

            // 429 (Rate Limit) の場合のみ再試行
            if (response.status === 429 && i < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelays[i]));
                continue;
            }
            
            // それ以外のエラーは即時終了
            return res.status(response.status).json({ error: lastError });
        }

        if (!response.ok) {
            return res.status(429).json({ error: 'AIの利用制限に達しました。1分ほど待ってから再度お試しください。' });
        }

        const apiData = await response.json();
        let resultText = apiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

        resultText = resultText.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();

        if (isJsonResponse) {
            try {
                res.status(200).json(JSON.parse(resultText));
            } catch (e) {
                res.status(500).json({ error: 'データの解析に失敗しました。' });
            }
        } else {
            res.status(200).json({ text: resultText });
        }

    } catch (error) {
        res.status(500).json({ error: `サーバーエラー: ${error.message}` });
    }
}
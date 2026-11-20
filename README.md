# 🍍 Pineapple AI

A private AI chat that runs entirely in your browser. It can search Wikipedia, remember things across chats, and works offline after the first load.

**Try it:** https://yijianxiao2023-netizen.github.io/PineappleAIrepo/

Needs a browser with WebGPU (latest Chrome or Edge).

## ⚠️ Please read

- **Use it appropriately.** Don't use Pineapple AI to harm, harass, cheat, or mislead anyone. It runs on your device and can make mistakes, so double-check anything important.
- **Don't delete this README.** If you copy, fork, or reuse this project, keep this file and the `LICENSE` file in it.
- **Give credit.** If you use or build on Pineapple AI, credit the creator:

  > Pineapple AI by **SlaxY1r** ([yijianxiao2023-netizen](https://github.com/yijianxiao2023-netizen))

## Accounts (required)

Everyone must sign in with Google or GitHub to use Pineapple AI. Their chats and memory sync across devices. **The site can't be used until this is set up**, so create a free [Supabase](https://supabase.com) project:

1. **Create a project** at supabase.com.
2. **Create the tables:** open **SQL Editor → New query**, paste everything in [`supabase-setup.sql`](supabase-setup.sql), and click **Run**.
3. **Set the website address:** go to **Authentication → URL Configuration**. Set **Site URL** to `https://yijianxiao2023-netizen.github.io/PineappleAIrepo/` and add the same address under **Redirect URLs**.
4. **Turn on GitHub sign-in:** go to **Authentication → Sign In / Providers → GitHub** and copy the **Callback URL** shown there. On GitHub, go to **Settings → Developer settings → OAuth Apps → New OAuth App**. Use the site address above as the homepage URL and paste the callback URL. Copy the app's **Client ID** and a new **Client secret** back into Supabase, turn GitHub on, and save.
5. **Turn on Google sign-in:** go to **Authentication → Sign In / Providers → Google**. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** (type: Web application) and add the Supabase callback URL under **Authorized redirect URIs**. Paste the Client ID and secret into Supabase, turn Google on, and save.
6. **Connect the site:** go to **Project Settings → API** and copy the **Project URL** and the **anon public** key into [`config.js`](config.js). The anon key is safe to make public: the database rules from step 2 only let each person read and change their own data. **Never** put the `service_role` key in this repo.

## Account limit

Pineapple AI allows at most **25 accounts**. This is enforced by the database (set up by `supabase-setup.sql`), so it can't be bypassed from the website. Existing users can always sign in. To free a spot, delete a user in **Authentication → Users**. To change the limit, edit `max_accounts` in `supabase-setup.sql` and run it again.

## Web search (optional)

Pineapple AI can search the web and read links through a small Supabase Edge Function in [`supabase/functions/web/index.ts`](supabase/functions/web/index.ts). Only signed-in users can use it, with a daily limit per person (40 searches, 150 pages read).

1. **Update the database:** run [`supabase-setup.sql`](supabase-setup.sql) again in **SQL Editor**. It's safe to re-run, and it adds the usage-limit table.
2. **Get a search key:** sign up free at [tavily.com](https://tavily.com) and copy your API key. Optionally, add an [Exa](https://exa.ai) key as a backup.
3. **Store the key in Supabase:** go to **Edge Functions → Secrets** and add `TAVILY_API_KEY` (and optionally `EXA_API_KEY`). For better live stock prices, also add a free [Finnhub](https://finnhub.io) key as `FINNHUB_API_KEY`; without it, stock quotes come from Stooq and may be about 15 minutes behind. **Never** put these keys in this repo.
4. **Deploy the function:** go to **Edge Functions → Deploy a new function → Via Editor**. Name it exactly `web`, paste in everything from `supabase/functions/web/index.ts`, and click **Deploy**.

Reading web pages doesn't use the search quota. Only searches do. **After changing `index.ts`, redeploy the function** by pasting the new code into the same function and clicking Deploy again.

## Credits

- Created by **SlaxY1r** ([yijianxiao2023-netizen](https://github.com/yijianxiao2023-netizen))
- Runs on [WebLLM](https://github.com/mlc-ai/web-llm) by the MLC AI team (Apache 2.0)
- Language models: [Qwen3](https://github.com/QwenLM/Qwen3) by the Qwen team (Apache 2.0)
- Search results from [Wikipedia](https://www.wikipedia.org/) and [Tavily](https://tavily.com)

## License

Licensed under the Apache License 2.0. See [`LICENSE`](LICENSE).

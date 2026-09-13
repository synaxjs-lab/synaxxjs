SYNAX Vercel fix

Why:
The current Vercel deployment is serving the Vite frontend, but the Express/WebSocket server is not being used to answer /api/* requests. That is why the SYNAX loading screen never finishes.

Fix:
1. Add Dockerfile.vercel to the ROOT of the SYNAX GitHub repository.
2. Add .dockerignore to the ROOT.
3. Commit and push both files to main.
4. Vercel will create a new deployment from the Dockerfile.vercel.
5. Open the new deployment URL and test /api/public/identities indirectly by loading SYNAX.

Important:
- Do not delete server.ts.
- Do not change the current UI.
- This keeps the real Express backend and WebSocket server together with the frontend.
- The current JSON database and uploads are still filesystem-based, so this deployment is suitable for testing but is not durable production storage...

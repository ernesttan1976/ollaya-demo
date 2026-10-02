FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node server.js snake-ollaya.html snake-rules-engine.js snake-calculations.js ./

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]

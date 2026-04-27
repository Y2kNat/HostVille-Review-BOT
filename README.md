
<p align="center">
  <img src="https://www.image2url.com/r2/default/images/1777332207044-62c22e8f-5ca3-4415-8445-b1aed5c90971.png" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-9.0.0-4f46e5?style=for-the-badge">
  <img src="https://img.shields.io/badge/node-16.9%2B-22c55e?style=for-the-badge">
  <img src="https://img.shields.io/badge/discord.js-v14-5865F2?style=for-the-badge">
  <img src="https://img.shields.io/badge/license-MIT-10b981?style=for-the-badge">
  <img src="https://img.shields.io/badge/status-online-22c55e?style=for-the-badge">
</p>

<br>

<h1 align="center">⭐ 𝙷𝚘𝚜𝚝𝚅𝚒𝚕𝚕𝚎 𝚁𝚎𝚟𝚒𝚎𝚠 • 𝙱𝙾𝚃</h1>

<p align="center">
  Sistema avançado de avaliação de staff com ranking semanal, cache inteligente e proteção anti rate-limit.
</p>

<p align="center">
  <b>𝙼𝚊𝚍𝚎 𝙱𝚢 𝚈𝟸𝚔_𝙽𝚊𝚝</b>
</p>

---

## ✦ 𝙰𝙱𝙾𝚄𝚃

> O **HostVille Review • BOT** é um sistema moderno de avaliação criado em **Node.js + discord.js v14**, focado em feedback da comunidade para membros da staff.

Ele permite que usuários avaliem a equipe com notas e comentários, gerando métricas, rankings e estatísticas automáticas.

---

## ✦ 𝙵𝙴𝙰𝚃𝚄𝚁𝙴𝚂

```txt
⭐ REVIEW SYSTEM    → Avaliação de 0 a 10
📊 STATS SYSTEM     → Estatísticas detalhadas
🏆 RANKING WEEKLY   → Top 3 semanal automático
📦 CACHE SYSTEM     → Cache inteligente (anti rate-limit)
🛡 PERMISSION       → Bloqueio para staff avaliar
📩 LOG SYSTEM       → Logs completos de avaliações
💾 DATABASE         → JSON persistente
🧠 ANTI SPAM        → Limite diário de avaliações
```

---

✦ 𝚂𝚈𝚂𝚃𝙴𝙼 𝙵𝙻𝙾𝚆

```mermaid
sequenceDiagram
    participant U as Usuário
    participant B as Bot
    participant DB as JSON Storage
    participant Log as Canal de Logs

    U->>B: Clica "Avaliar equipe"
    B->>U: Menu dropdown (staff disponível)
    U->>B: Seleciona membro da staff
    B->>U: Modal (Nota 0-10 + Feedback)
    U->>B: Envia avaliação
    B->>B: Valida nota (0-10)
    alt Nota inválida ou limite diário
        B-->>U: Erro ephemeral
    else Avaliação válida
        B->>DB: Salva nova review (reviews.json)
        B->>DB: Atualiza stats.json
        B->>Log: Log detalhado da avaliação
        B->>B: Recalcula ranking semanal
        B-->>U: Confirmação ephemeral
    end
```

---

✦ 𝙍𝘼𝙉𝙆𝙄𝙉𝙂 𝙎𝙀𝙈𝘼𝙉𝘼𝙇

```
╭────────────────────────╮
│ 🥇 Top 1 → Melhor média │
│ 🥈 Top 2 → Segundo lugar │
│ 🥉 Top 3 → Terceiro     │
╰────────────────────────╯
✔ Atualizado automaticamente
✔ Baseado nas avaliações da semana
✔ Enviado no canal de logs
```

---

✦ 𝘾𝙊𝙈𝙈𝘼𝙉𝘿𝙎

/stats

📊 Estatísticas do usuário
• Média de notas
• Mediana
• Melhor / pior nota
• Últimas avaliações

/ranking

🏆 Ranking semanal
• Top 3 staff
• Média de avaliações
• Total de reviews

/clear

🗑️ Limpa mensagens de um usuário
• Apenas staff
• Limite configurável
• Log automático

/clearall

🧹 Limpa canal completo
• Apenas staff
• Até 500 mensagens
• Ignora fixadas

---

✦ 𝙋𝙀𝙍𝙈𝙄𝙎𝙎𝙄𝙊𝙉𝙎

👮 STAFF
✔ Pode usar comandos de moderação
✔ NÃO pode avaliar outros staff

👤 USUÁRIOS
✔ Podem avaliar staff
✔ Limite de 10 avaliações por dia

---

✦ 𝘿𝘼𝙏𝘼𝘽𝘼𝙎𝙀

📁 data/reviews.json
• Armazena todas avaliações

📁 data/stats.json
• Estatísticas globais

✔ Leve
✔ Rápido
✔ Persistente
✔ Fácil manutenção

---

✦ 𝘼𝙉𝙏𝙄 𝙍𝘼𝙏𝙀 𝙇𝙄𝙈𝙄𝙏

📦 Cache de membros staff (5 min)
⏱ Delay entre requisições
🔄 Atualização automática
⚡ Redução de chamadas API

---

✦ 𝙊𝘽𝙅𝙀𝘾𝙏𝙄𝙑𝙀

✔ Melhorar a qualidade da staff
✔ Coletar feedback real dos usuários
✔ Automatizar métricas
✔ Criar competitividade saudável
✔ Evitar abuso de API

---

📌 Status

🟢 Online • ⚡ Estável • 🔒 Seguro

---

<p align="center">
  <b>© 2026 HostVille Moderação Bot • 𝙼𝚊𝚍𝚎 𝙱𝚢 𝚈𝟸𝚔_𝙽𝚊𝚝</b>
</p>

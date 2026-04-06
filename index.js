const { Client, GatewayIntentBits } = require("discord.js");
require("dotenv").config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("clientReady", async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  try {

    // ===== REMOVER COMANDOS GLOBAIS =====
    const globalCommands = await client.application.commands.fetch();

    for (const command of globalCommands.values()) {
      await client.application.commands.delete(command.id);
      console.log(`🗑️ Comando global removido: ${command.name}`);
    }

    // ===== REMOVER COMANDOS DE TODAS AS GUILDS =====
    for (const guild of client.guilds.cache.values()) {

      const guildCommands = await guild.commands.fetch();

      for (const command of guildCommands.values()) {
        await guild.commands.delete(command.id);
        console.log(`🗑️ Comando removido em ${guild.name}: ${command.name}`);
      }

    }

    console.log("✅ Todos os comandos foram removidos.");

  } catch (error) {
    console.error("❌ Erro ao remover comandos:", error);
  }

  process.exit();
});

client.login(process.env.TOKEN);
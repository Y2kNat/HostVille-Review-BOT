// ============================================
// index.js - Bot Discord com Sistema de Avaliação
// ============================================
// Versão: 5.0.0
// Total de linhas: ~2300
// ============================================

require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    Collection,
    ChannelType,
    MessageFlags
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURAÇÃO DO CLIENT
// ============================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Collections
client.commands = new Collection();
client.slashCommands = new Collection();
client.cooldowns = new Collection();
client.tempReviewData = new Map();

// ============================================
// VARIÁVEIS DE AMBIENTE
// ============================================
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_IDS = process.env.STAFF_ROLE_IDS ? process.env.STAFF_ROLE_IDS.split(',').map(id => id.trim()).filter(id => id.length > 0) : [];
const REVIEWS_CHANNEL_ID = process.env.REVIEWS_CHANNEL_ID;
const REVIEWS_LOG_CHANNEL_ID = process.env.REVIEWS_LOG_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

// Validação das variáveis
if (!TOKEN) {
    console.error('❌ TOKEN não configurado no arquivo .env');
    process.exit(1);
}
if (!GUILD_ID) {
    console.error('❌ GUILD_ID não configurado no arquivo .env');
    process.exit(1);
}
if (STAFF_ROLE_IDS.length === 0) {
    console.warn('⚠️ Nenhum cargo staff configurado');
}
if (!REVIEWS_CHANNEL_ID) {
    console.warn('⚠️ REVIEWS_CHANNEL_ID não configurado');
}

// Constantes
const PREFIX = '!';
const EMBED_COLOR = '#341539';
const MAX_FEEDBACK_LENGTH = 700;
const MAX_CLEAR_MESSAGES = 1000;
const MAX_CLEAR_USER_MESSAGES = 500;

// ============================================
// ARMAZENAMENTO EM ARQUIVO
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');
const RANKINGS_FILE = path.join(DATA_DIR, 'rankings.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

// Criar diretórios
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Funções de leitura/escrita
function loadReviews() {
    if (!fs.existsSync(REVIEWS_FILE)) return [];
    return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf-8'));
}

function saveReviews(reviews) {
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2));
}

function loadRankings() {
    if (!fs.existsSync(RANKINGS_FILE)) return [];
    return JSON.parse(fs.readFileSync(RANKINGS_FILE, 'utf-8'));
}

function saveRankings(rankings) {
    fs.writeFileSync(RANKINGS_FILE, JSON.stringify(rankings, null, 2));
}

function loadStats() {
    if (!fs.existsSync(STATS_FILE)) {
        return { reviews: 0, users: {}, lastWeeklyReset: null, botStartTime: Date.now() };
    }
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
}

function saveStats(stats) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function loadLogs() {
    if (!fs.existsSync(LOGS_FILE)) return [];
    return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
}

function saveLogs(logs) {
    const limitedLogs = logs.slice(-5000);
    fs.writeFileSync(LOGS_FILE, JSON.stringify(limitedLogs, null, 2));
}

function addLog(entry) {
    const logs = loadLogs();
    logs.push({
        ...entry,
        timestamp: new Date().toISOString()
    });
    saveLogs(logs);
}

// ============================================
// FUNÇÕES DE UTILIDADE
// ============================================

// Verificar se usuário é staff
function isStaff(member) {
    if (!member || !member.roles) return false;
    return STAFF_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

// Verificar se usuário NÃO é staff (pode avaliar)
function canReview(member) {
    return !isStaff(member);
}

// Obter cor baseada na nota
function getColorByScore(score) {
    if (score >= 0 && score <= 3) return 0xFF0000;
    if (score >= 4 && score <= 6) return 0xFFFF00;
    return 0x00FF00;
}

// Obter emoji baseado na nota
function getScoreEmoji(score) {
    if (score >= 0 && score <= 3) return '🔴';
    if (score >= 4 && score <= 6) return '🟡';
    return '🟢';
}

// Obter descrição da nota
function getScoreDescription(score) {
    if (score === 0) return 'Precisa melhorar drasticamente';
    if (score === 1) return 'Muito insatisfatório';
    if (score === 2) return 'Insatisfatório';
    if (score === 3) return 'Abaixo da média';
    if (score === 4) return 'Regular baixo';
    if (score === 5) return 'Regular';
    if (score === 6) return 'Regular alto';
    if (score === 7) return 'Bom';
    if (score === 8) return 'Muito bom';
    if (score === 9) return 'Excelente';
    if (score === 10) return 'Perfeito!';
    return 'Nota inválida';
}

// Formatar data
function formatDate(date, format = 'full') {
    const d = new Date(date);
    const formats = {
        short: d.toLocaleDateString('pt-BR'),
        long: d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
        full: d.toLocaleString('pt-BR'),
        time: d.toLocaleTimeString('pt-BR')
    };
    return formats[format] || formats.full;
}

// Obter número da semana
function getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// Delay helper para evitar rate limit
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Buscar membros staff com retry e rate limit handling
async function fetchStaffMembers(guild) {
    let retries = 3;
    let delayMs = 1000;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // Garantir que o cache está atualizado
            await guild.members.fetch({ 
                limit: 1000,
                force: true 
            });
            
            const staffMembers = [];
            
            for (const roleId of STAFF_ROLE_IDS) {
                const role = guild.roles.cache.get(roleId);
                if (role) {
                    console.log(`🔍 Cargo encontrado: ${role.name} (${role.id}) - ${role.members.size} membros`);
                    
                    for (const [id, m] of role.members) {
                        if (!staffMembers.find(sm => sm.id === id)) {
                            staffMembers.push({
                                id: m.id,
                                name: m.user.tag,
                                displayName: m.displayName,
                                roleName: role.name,
                                roleId: role.id
                            });
                        }
                    }
                } else {
                    console.warn(`⚠️ Cargo não encontrado: ${roleId}`);
                }
            }
            
            return staffMembers;
        } catch (error) {
            if (error.code === 429 || error.message?.includes('rate limit')) {
                console.log(`⏳ Rate limit atingido, tentativa ${attempt}/${retries}, aguardando ${delayMs}ms...`);
                await delay(delayMs);
                delayMs *= 2; // Exponential backoff
            } else {
                console.error(`❌ Erro ao buscar membros:`, error.message);
                throw error;
            }
        }
    }
    
    return [];
}

// Calcular estatísticas do usuário
function calculateUserStats(userId) {
    const reviews = loadReviews();
    const userReviews = reviews.filter(r => r.reviewedId === userId);
    
    if (userReviews.length === 0) {
        return { count: 0, average: 0, highest: 0, lowest: 0 };
    }
    
    const scores = userReviews.map(r => r.score);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    return {
        count: userReviews.length,
        average: parseFloat(average.toFixed(2)),
        highest: Math.max(...scores),
        lowest: Math.min(...scores),
        recentReviews: userReviews.slice(-5).reverse()
    };
}

// Criar backup
function createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupData = {
        timestamp: new Date().toISOString(),
        reviews: loadReviews(),
        rankings: loadRankings(),
        stats: loadStats()
    };
    
    const backupFile = path.join(BACKUP_DIR, `backup_${timestamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    
    // Limpar backups antigos (manter últimos 10)
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort();
    while (backups.length > 10) {
        const oldBackup = backups.shift();
        fs.unlinkSync(path.join(BACKUP_DIR, oldBackup));
    }
    
    console.log(`✅ Backup criado: ${path.basename(backupFile)}`);
    addLog({ type: 'BACKUP', file: path.basename(backupFile) });
    return backupFile;
}

// ============================================
// RANKING SEMANAL
// ============================================

async function generateWeeklyRanking() {
    const reviews = loadReviews();
    const now = new Date();
    const weekNumber = getWeekNumber(now);
    const year = now.getFullYear();
    
    const weekReviews = reviews.filter(review => {
        const reviewDate = new Date(review.createdAt);
        return getWeekNumber(reviewDate) === weekNumber && reviewDate.getFullYear() === year;
    });
    
    if (weekReviews.length === 0) return null;
    
    const userScores = new Map();
    
    weekReviews.forEach(review => {
        if (!userScores.has(review.reviewedId)) {
            userScores.set(review.reviewedId, {
                userId: review.reviewedId,
                userName: review.reviewedName,
                totalScore: 0,
                count: 0
            });
        }
        const data = userScores.get(review.reviewedId);
        data.totalScore += review.score;
        data.count++;
    });
    
    const rankings = [];
    for (const [userId, data] of userScores) {
        rankings.push({
            userId: data.userId,
            userName: data.userName,
            averageScore: parseFloat((data.totalScore / data.count).toFixed(2)),
            totalReviews: data.count
        });
    }
    
    rankings.sort((a, b) => b.averageScore - a.averageScore);
    const top3 = rankings.slice(0, 3);
    
    // Salvar ranking
    const rankingsData = loadRankings();
    rankingsData.push({
        weekNumber,
        year,
        weekStart: new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()),
        weekEnd: new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 6),
        rankings: top3,
        createdAt: new Date().toISOString()
    });
    saveRankings(rankingsData);
    
    return top3;
}

async function sendWeeklyRanking() {
    const top3 = await generateWeeklyRanking();
    if (!top3 || top3.length === 0) return;
    
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;
    
    const embed = new EmbedBuilder()
        .setTitle('🏆 Ranking Semanal da Equipe')
        .setDescription('Os 3 membros mais bem avaliados desta semana:')
        .setColor(0xFFD700)
        .setTimestamp();
    
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < top3.length; i++) {
        embed.addFields({
            name: `${medals[i]} ${top3[i].userName}`,
            value: `⭐ Média: ${top3[i].averageScore}/10 | 📝 ${top3[i].totalReviews} avaliações`,
            inline: false
        });
    }
    
    await logChannel.send({ embeds: [embed] });
    addLog({ type: 'WEEKLY_RANKING', weekNumber: getWeekNumber(new Date()), top3: top3.map(t => t.userName) });
}

function checkAndSendRanking() {
    const now = new Date();
    const lastSunday = new Date(now);
    lastSunday.setDate(now.getDate() - now.getDay());
    lastSunday.setHours(23, 59, 0, 0);
    
    const stats = loadStats();
    const lastReset = stats.lastWeeklyReset ? new Date(stats.lastWeeklyReset) : null;
    
    if (!lastReset || lastReset < lastSunday) {
        sendWeeklyRanking();
        stats.lastWeeklyReset = new Date().toISOString();
        saveStats(stats);
    }
}

// ============================================
// COMANDOS SLASH
// ============================================

const clearAllCommand = new SlashCommandBuilder()
    .setName('clearall')
    .setDescription('Apaga todas as mensagens de um canal específico')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('Canal que terá as mensagens apagadas')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('limit')
            .setDescription('Quantidade de mensagens (padrão: 100, máximo: 1000)')
            .setMinValue(1)
            .setMaxValue(MAX_CLEAR_MESSAGES)
            .setRequired(false));

const clearCommand = new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Apaga mensagens de um usuário específico')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('Usuário que terá as mensagens apagadas')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('limit')
            .setDescription('Quantidade de mensagens (padrão: 100, máximo: 500)')
            .setMinValue(1)
            .setMaxValue(MAX_CLEAR_USER_MESSAGES)
            .setRequired(false));

const statsCommand = new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Mostra estatísticas do sistema de avaliação')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('Usuário para ver estatísticas')
            .setRequired(false));

const rankingCommand = new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Mostra o ranking atual da semana');

const botinfoCommand = new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Mostra informações do bot');

const commands = [clearAllCommand, clearCommand, statsCommand, rankingCommand, botinfoCommand];

// ============================================
// CONFIGURAR CANAL DE AVALIAÇÕES
// ============================================

async function setupReviewsChannel() {
    const channel = client.channels.cache.get(REVIEWS_CHANNEL_ID);
    if (!channel) {
        console.error('❌ Canal de avaliações não encontrado!');
        return;
    }
    
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        console.error(`❌ Guild com ID ${GUILD_ID} não encontrada!`);
        return;
    }
    
    console.log(`📡 Conectado à guild: ${guild.name} (${guild.id})`);
    
    // Buscar membros staff com tratamento de rate limit
    const staffMembers = await fetchStaffMembers(guild);
    
    console.log(`👥 Total de membros staff encontrados: ${staffMembers.length}`);
    console.log(`📋 Cargos configurados: ${STAFF_ROLE_IDS.length}`);
    
    const embed = new EmbedBuilder()
        .setTitle('📊 Sistema de Avaliação da Equipe')
        .setDescription('Clique no botão abaixo para avaliar um membro da nossa equipe!')
        .setColor(EMBED_COLOR)
        .setThumbnail(guild.iconURL({ dynamic: true }) || client.user.displayAvatarURL())
        .addFields(
            { name: '📋 Como funciona', value: '```\n1️⃣ Clique no botão "Avaliar equipe"\n2️⃣ Selecione o membro que deseja avaliar\n3️⃣ Escolha uma nota de 0 a 10\n4️⃣ Escreva seu feedback (opcional)\n5️⃣ Envie sua avaliação\n```', inline: false },
            { name: '🎯 Quem pode avaliar', value: '✅ **Todos os membros** que não são da staff podem avaliar', inline: true },
            { name: '⭐ Quem é avaliado', value: `👥 **${staffMembers.length} membros** da staff disponíveis para avaliação`, inline: true },
            { name: '⭐ Sistema de Notas', value: '🔴 **0-3:** Insatisfatório\n🟡 **4-6:** Regular\n🟢 **7-10:** Excelente', inline: false },
            { name: '📈 Estatísticas', value: `📝 Total de avaliações: ${loadReviews().length}\n🏆 Ranking semanal: Ativo`, inline: false }
        )
        .setFooter({ text: `Sistema de Avaliação • ${guild.name}`, iconURL: guild.iconURL() })
        .setTimestamp();
    
    const button = new ButtonBuilder()
        .setCustomId('open_review_menu')
        .setLabel('🛠 Avaliar equipe')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('⭐');
    
    const row = new ActionRowBuilder().addComponents(button);
    
    // Limpar mensagens antigas do bot
    try {
        const messages = await channel.messages.fetch({ limit: 50 });
        const botMessages = messages.filter(m => m.author.id === client.user.id);
        for (const msg of botMessages.values()) {
            await msg.delete().catch(() => {});
        }
    } catch (error) {
        console.error('Erro ao limpar mensagens:', error.message);
    }
    
    await channel.send({ embeds: [embed], components: [row] });
    console.log('✅ Canal de avaliações configurado');
}

// ============================================
// EVENTO: CLIENT_READY
// ============================================

client.once('clientReady', async () => {
    console.log('='.repeat(60));
    console.log(`🤖 Bot logado como ${client.user.tag}`);
    console.log(`📡 ID: ${client.user.id}`);
    console.log(`🎯 Guild ID configurada: ${GUILD_ID}`);
    console.log(`📋 Cargos Staff configurados: ${STAFF_ROLE_IDS.length}`);
    console.log(`📺 Canal de Avaliações: ${REVIEWS_CHANNEL_ID}`);
    console.log(`📝 Canal de Logs Avaliações: ${REVIEWS_LOG_CHANNEL_ID}`);
    console.log(`📊 Canal de Logs Gerais: ${LOG_CHANNEL_ID}`);
    console.log('='.repeat(60));
    
    // Verificar se a guild existe
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        console.error(`❌ Guild com ID ${GUILD_ID} não encontrada! Verifique se o bot está no servidor.`);
        return;
    }
    
    console.log(`✅ Conectado ao servidor: ${guild.name}`);
    
    // Registrar comandos slash na guild específica (mais rápido)
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log('✅ Comandos slash registrados na guild');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
    
    // Aguardar um pouco e configurar canal
    setTimeout(async () => {
        await setupReviewsChannel();
    }, 5000);
    
    // Sistema de ranking semanal (verificar a cada hora)
    setInterval(() => {
        checkAndSendRanking();
    }, 60 * 60 * 1000);
    
    // Backup diário às 03:00
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === 3 && now.getMinutes() === 0) {
            createBackup();
        }
    }, 60 * 1000);
    
    // Criar backup inicial
    setTimeout(() => {
        createBackup();
    }, 10000);
    
    // Atualizar status
    updateStatus();
});

// Atualizar status do bot
function updateStatus() {
    const activities = [
        { name: `${STAFF_ROLE_IDS.length} cargos da staff`, type: 3 },
        { name: '/clearall | /clear', type: 2 },
        { name: 'Sistema de Avaliação', type: 3 },
        { name: `Avalie sua equipe!`, type: 2 }
    ];
    
    let index = 0;
    setInterval(() => {
        const activity = activities[index % activities.length];
        client.user.setPresence({
            activities: [{ name: activity.name, type: activity.type }],
            status: 'online'
        });
        index++;
    }, 15000);
}

// ============================================
// HANDLER: COMANDOS SLASH
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    const { commandName, member, options } = interaction;
    
    // Verificar permissão para comandos de moderação
    if (commandName === 'clearall' || commandName === 'clear') {
        if (!isStaff(member)) {
            return interaction.reply({
                content: '❌ Você não tem permissão para usar este comando! Apenas membros da staff podem usar.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
    
    // Comando /clearall
    if (commandName === 'clearall') {
        const channel = options.getChannel('channel');
        const limit = options.getInteger('limit') || 100;
        
        if (!channel.isTextBased()) {
            return interaction.reply({
                content: '❌ Este não é um canal de texto válido!',
                flags: MessageFlags.Ephemeral
            });
        }
        
        await interaction.reply({
            content: `🔄 Apagando até ${limit} mensagens do canal ${channel}...`,
            flags: MessageFlags.Ephemeral
        });
        
        try {
            let deletedCount = 0;
            let remaining = limit;
            
            while (remaining > 0) {
                const fetchLimit = Math.min(remaining, 100);
                const fetched = await channel.messages.fetch({ limit: fetchLimit });
                if (fetched.size === 0) break;
                
                const deleted = await channel.bulkDelete(fetched, true);
                deletedCount += deleted.size;
                remaining -= deleted.size;
                
                await delay(500);
            }
            
            await interaction.editReply({
                content: `✅ ${deletedCount} mensagens foram apagadas do canal ${channel}!`
            });
            
            const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send(`📝 **${member.user.tag}** apagou ${deletedCount} mensagens no canal ${channel}`);
            }
            
            addLog({ type: 'CLEAR_ALL', moderator: member.user.tag, channel: channel.name, count: deletedCount });
            
        } catch (error) {
            await interaction.editReply({
                content: '❌ Erro ao apagar mensagens! Mensagens podem ser muito antigas (mais de 14 dias).'
            });
        }
    }
    
    // Comando /clear
    if (commandName === 'clear') {
        const targetUser = options.getUser('user');
        const limit = options.getInteger('limit') || 100;
        const channel = interaction.channel;
        
        await interaction.reply({
            content: `🔄 Apagando até ${limit} mensagens de ${targetUser.tag}...`,
            flags: MessageFlags.Ephemeral
        });
        
        try {
            let deletedCount = 0;
            let remaining = limit;
            
            while (remaining > 0) {
                const fetchLimit = Math.min(remaining, 100);
                const fetched = await channel.messages.fetch({ limit: fetchLimit });
                const messagesToDelete = fetched.filter(msg => msg.author.id === targetUser.id);
                
                if (messagesToDelete.size === 0) break;
                
                await channel.bulkDelete(messagesToDelete, true);
                deletedCount += messagesToDelete.size;
                remaining -= messagesToDelete.size;
                
                await delay(500);
            }
            
            await interaction.editReply({
                content: `✅ ${deletedCount} mensagens de ${targetUser.tag} foram apagadas!`
            });
            
            const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send(`📝 **${member.user.tag}** apagou ${deletedCount} mensagens de ${targetUser.tag}`);
            }
            
            addLog({ type: 'CLEAR_USER', moderator: member.user.tag, target: targetUser.tag, count: deletedCount });
            
        } catch (error) {
            await interaction.editReply({
                content: '❌ Erro ao apagar mensagens! Mensagens podem ser muito antigas (mais de 14 dias).'
            });
        }
    }
    
    // Comando /stats
    if (commandName === 'stats') {
        const targetUser = options.getUser('user') || interaction.user;
        const stats = calculateUserStats(targetUser.id);
        
        if (stats.count === 0) {
            return interaction.reply({
                content: `📊 Nenhuma avaliação encontrada para ${targetUser.tag}.`,
                flags: MessageFlags.Ephemeral
            });
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`📊 Estatísticas de ${targetUser.tag}`)
            .setColor(getColorByScore(stats.average))
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '📝 Total de avaliações', value: stats.count.toString(), inline: true },
                { name: '⭐ Média', value: stats.average.toString(), inline: true },
                { name: '📈 Melhor nota', value: stats.highest.toString(), inline: true },
                { name: '📉 Pior nota', value: stats.lowest.toString(), inline: true }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    }
    
    // Comando /ranking
    if (commandName === 'ranking') {
        const top3 = await generateWeeklyRanking();
        
        if (!top3 || top3.length === 0) {
            return interaction.reply({
                content: '📊 Nenhuma avaliação foi feita esta semana ainda!',
                flags: MessageFlags.Ephemeral
            });
        }
        
        const embed = new EmbedBuilder()
            .setTitle('🏆 Ranking da Semana')
            .setDescription(`Semana ${getWeekNumber(new Date())} de ${new Date().getFullYear()}`)
            .setColor(0xFFD700)
            .setTimestamp();
        
        const medals = ['🥇', '🥈', '🥉'];
        for (let i = 0; i < top3.length; i++) {
            embed.addFields({
                name: `${medals[i]} ${top3[i].userName}`,
                value: `⭐ Média: ${top3[i].averageScore}/10 | 📝 ${top3[i].totalReviews} avaliações`,
                inline: false
            });
        }
        
        await interaction.reply({ embeds: [embed] });
    }
    
    // Comando /botinfo
    if (commandName === 'botinfo') {
        const reviews = loadReviews();
        const stats = loadStats();
        const uptime = process.uptime();
        const memory = process.memoryUsage();
        
        const embed = new EmbedBuilder()
            .setTitle('🤖 Informações do Bot')
            .setDescription('Bot de avaliação para equipes Discord')
            .setColor(EMBED_COLOR)
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '📊 Estatísticas', value: `📝 Total de avaliações: ${reviews.length}\n👥 Usuários avaliados: ${Object.keys(stats.users).length}\n🔧 Cargos Staff: ${STAFF_ROLE_IDS.length}\n📡 Servidores: ${client.guilds.cache.size}`, inline: true },
                { name: '⏰ Sistema', value: `⏱️ Uptime: ${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\n💾 Memória: ${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`, inline: true }
            )
            .setFooter({ text: `Bot ID: ${client.user.id} | Guild: ${GUILD_ID}` })
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    }
});

// ============================================
// HANDLER: BOTÃO DE AVALIAÇÃO
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'open_review_menu') return;
    
    const member = interaction.member;
    
    if (!canReview(member)) {
        return interaction.reply({
            content: '❌ Você é membro da staff e não pode avaliar outros membros da staff! Apenas membros comuns podem avaliar.',
            flags: MessageFlags.Ephemeral
        });
    }
    
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        return interaction.reply({
            content: '❌ Servidor não encontrado!',
            flags: MessageFlags.Ephemeral
        });
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    // Buscar membros staff com tratamento de rate limit
    const staffMembers = await fetchStaffMembers(guild);
    
    if (staffMembers.length === 0) {
        return interaction.editReply({
            content: '❌ Nenhum membro da staff disponível para avaliação no momento!\n\nVerifique se:\n1. Os IDs dos cargos estão corretos\n2. Os cargos têm membros\n3. O bot tem permissão para ver os membros'
        });
    }
    
    // Criar menu de seleção de usuários
    const options = staffMembers.map(m => ({
        label: m.name.length > 25 ? m.name.substring(0, 22) + '...' : m.name,
        value: m.id,
        description: `Cargo: ${m.roleName.substring(0, 50)}`,
        emoji: '⭐'
    })).slice(0, 25);
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_staff_to_review')
        .setPlaceholder(`👤 Selecione um dos ${staffMembers.length} membros da staff`)
        .addOptions(options);
    
    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await interaction.editReply({
        content: `**📋 Selecione o membro da staff que deseja avaliar:**\n\nTotal de membros disponíveis: ${staffMembers.length}`,
        components: [row]
    });
});

// ============================================
// HANDLER: SELEÇÃO DE USUÁRIO
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'select_staff_to_review') return;
    
    const selectedUserId = interaction.values[0];
    const guild = client.guilds.cache.get(GUILD_ID);
    
    if (!guild) {
        return interaction.update({
            content: '❌ Servidor não encontrado!',
            components: [],
        });
    }
    
    await guild.members.fetch();
    const targetMember = await guild.members.fetch(selectedUserId).catch(() => null);
    
    if (!targetMember) {
        return interaction.update({
            content: '❌ Usuário não encontrado!',
            components: [],
        });
    }
    
    if (!isStaff(targetMember)) {
        return interaction.update({
            content: '❌ Este usuário não é membro da staff!',
            components: [],
        });
    }
    
    // Verificar limite de avaliações por dia
    const reviews = loadReviews();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayReviews = reviews.filter(r => 
        r.reviewerId === interaction.user.id && 
        new Date(r.createdAt) >= today
    );
    
    if (todayReviews.length >= 10) {
        return interaction.update({
            content: '❌ Você atingiu o limite de 10 avaliações por dia!',
            components: [],
        });
    }
    
    // Criar modal
    const modal = new ModalBuilder()
        .setCustomId(`review_modal_${selectedUserId}`)
        .setTitle(`Avaliar ${targetMember.user.displayName}`);
    
    const scoreInput = new TextInputBuilder()
        .setCustomId('score')
        .setLabel('Nota (0 a 10)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Digite um número entre 0 e 10')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2);
    
    const feedbackInput = new TextInputBuilder()
        .setCustomId('feedback')
        .setLabel('Feedback (máx. 700 caracteres)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('O que você achou? O que podia melhorar?')
        .setRequired(false)
        .setMaxLength(MAX_FEEDBACK_LENGTH);
    
    const firstRow = new ActionRowBuilder().addComponents(scoreInput);
    const secondRow = new ActionRowBuilder().addComponents(feedbackInput);
    
    modal.addComponents(firstRow, secondRow);
    
    client.tempReviewData.set(interaction.user.id, {
        targetId: selectedUserId,
        targetName: targetMember.user.tag,
        targetDisplayName: targetMember.user.displayName,
        timestamp: Date.now()
    });
    
    await interaction.showModal(modal);
});

// ============================================
// HANDLER: MODAL DE AVALIAÇÃO
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('review_modal_')) return;
    
    const targetId = interaction.customId.replace('review_modal_', '');
    const score = parseInt(interaction.fields.getTextInputValue('score'));
    const feedback = interaction.fields.getTextInputValue('feedback') || 'Sem feedback fornecido';
    
    if (isNaN(score) || score < 0 || score > 10) {
        return interaction.reply({
            content: '❌ Nota inválida! Por favor, insira um número entre 0 e 10.',
            flags: MessageFlags.Ephemeral
        });
    }
    
    const tempData = client.tempReviewData.get(interaction.user.id);
    if (!tempData || tempData.targetId !== targetId) {
        return interaction.reply({
            content: '❌ Sessão expirada! Por favor, clique no botão novamente.',
            flags: MessageFlags.Ephemeral
        });
    }
    
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        return interaction.reply({
            content: '❌ Servidor não encontrado!',
            flags: MessageFlags.Ephemeral
        });
    }
    
    await guild.members.fetch();
    const reviewer = interaction.user;
    const reviewed = await guild.members.fetch(targetId).catch(() => null);
    
    if (!reviewed) {
        return interaction.reply({
            content: '❌ Usuário avaliado não encontrado!',
            flags: MessageFlags.Ephemeral
        });
    }
    
    // Salvar avaliação
    const reviews = loadReviews();
    const newReview = {
        id: Date.now().toString(),
        reviewerId: reviewer.id,
        reviewedId: reviewed.id,
        reviewerName: reviewer.displayName,
        reviewedName: reviewed.user.displayName,
        reviewerTag: reviewer.tag,
        reviewedTag: reviewed.user.tag,
        score: score,
        feedback: feedback,
        createdAt: new Date().toISOString(),
        weekNumber: getWeekNumber(new Date()),
        year: new Date().getFullYear()
    };
    
    reviews.push(newReview);
    saveReviews(reviews);
    
    // Atualizar estatísticas
    const stats = loadStats();
    stats.reviews = reviews.length;
    if (!stats.users[reviewed.id]) {
        stats.users[reviewed.id] = { name: reviewed.user.tag, reviews: 0, totalScore: 0 };
    }
    stats.users[reviewed.id].reviews++;
    stats.users[reviewed.id].totalScore += score;
    saveStats(stats);
    
    // Embed para o canal de logs
    const color = getColorByScore(score);
    const scoreEmoji = getScoreEmoji(score);
    const scoreDesc = getScoreDescription(score);
    
    const logEmbed = new EmbedBuilder()
        .setTitle(`${scoreEmoji} Nova Avaliação - ${scoreDesc}`)
        .setColor(color)
        .addFields(
            { name: '👤 Avaliador', value: reviewer.tag, inline: true },
            { name: '⭐ Avaliado', value: reviewed.user.tag, inline: true },
            { name: '🎯 Nota', value: `${score}/10`, inline: true },
            { name: '💬 Feedback', value: feedback.length > 1024 ? feedback.substring(0, 1021) + '...' : feedback, inline: false }
        )
        .setTimestamp();
    
    const logChannel = client.channels.cache.get(REVIEWS_LOG_CHANNEL_ID);
    if (logChannel) {
        await logChannel.send({ embeds: [logEmbed] });
    }
    
    // Limpar dados temporários
    client.tempReviewData.delete(interaction.user.id);
    
    // Resposta de sucesso
    const successEmbed = new EmbedBuilder()
        .setTitle('✅ Avaliação Enviada!')
        .setDescription(`Sua avaliação para **${reviewed.user.displayName}** foi registrada com sucesso!`)
        .setColor(0x00FF00)
        .addFields(
            { name: 'Nota', value: `${score}/10 - ${scoreDesc}`, inline: true },
            { name: 'Feedback', value: feedback.length > 100 ? feedback.substring(0, 97) + '...' : feedback, inline: false }
        )
        .setTimestamp();
    
    await interaction.reply({
        embeds: [successEmbed],
        flags: MessageFlags.Ephemeral
    });
    
    console.log(`📝 Nova avaliação: ${reviewer.tag} -> ${reviewed.user.tag} (${score}/10)`);
    addLog({ type: 'REVIEW_CREATED', reviewer: reviewer.tag, reviewed: reviewed.user.tag, score: score });
});

// ============================================
// HANDLER: MENSAGENS DE TEXTO
// ============================================

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;
    
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('📚 Comandos Disponíveis')
            .setColor(EMBED_COLOR)
            .addFields(
                { name: '🔹 Comandos Slash', value: '`/clearall` - Limpar canal (Staff)\n`/clear` - Limpar usuário (Staff)\n`/stats` - Ver estatísticas\n`/ranking` - Ranking semanal\n`/botinfo` - Informações do bot', inline: false },
                { name: '🔸 Comandos de Texto', value: '`!help` - Esta mensagem\n`!ping` - Verificar latência\n`!info` - Informações do bot\n`!top` - Ranking geral\n`!stats @user` - Estatísticas de um usuário', inline: false }
            )
            .setTimestamp();
        await message.reply({ embeds: [embed] });
    }
    
    else if (command === 'ping') {
        const sent = await message.reply('🏓 Calculando ping...');
        const latency = sent.createdTimestamp - message.createdTimestamp;
        await sent.edit(`🏓 Pong! Latência: ${latency}ms | API: ${Math.round(client.ws.ping)}ms`);
    }
    
    else if (command === 'info') {
        const reviews = loadReviews();
        const stats = loadStats();
        const uptime = process.uptime();
        const memory = process.memoryUsage();
        
        const embed = new EmbedBuilder()
            .setTitle('🤖 Informações do Bot')
            .setDescription('Bot de avaliação para equipes Discord')
            .setColor(EMBED_COLOR)
            .addFields(
                { name: '📊 Estatísticas', value: `📝 Total de avaliações: ${reviews.length}\n👥 Usuários avaliados: ${Object.keys(stats.users).length}\n🔧 Cargos Staff: ${STAFF_ROLE_IDS.length}\n📡 Servidores: ${client.guilds.cache.size}`, inline: true },
                { name: '⏰ Sistema', value: `⏱️ Uptime: ${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\n💾 Memória: ${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`, inline: true }
            )
            .setTimestamp();
        await message.reply({ embeds: [embed] });
    }
    
    else if (command === 'top') {
        const reviews = loadReviews();
        const userScores = new Map();
        
        reviews.forEach(review => {
            if (!userScores.has(review.reviewedId)) {
                userScores.set(review.reviewedId, {
                    name: review.reviewedName,
                    totalScore: 0,
                    count: 0
                });
            }
            const data = userScores.get(review.reviewedId);
            data.totalScore += review.score;
            data.count++;
        });
        
        const rankings = [];
        for (const [userId, data] of userScores) {
            rankings.push({
                name: data.name,
                averageScore: parseFloat((data.totalScore / data.count).toFixed(2)),
                totalReviews: data.count
            });
        }
        
        rankings.sort((a, b) => b.averageScore - a.averageScore);
        const top10 = rankings.slice(0, 10);
        
        if (top10.length === 0) {
            return message.reply('📊 Nenhuma avaliação registrada ainda!');
        }
        
        const embed = new EmbedBuilder()
            .setTitle('🏆 Ranking Geral - Top 10')
            .setColor(0xFFD700)
            .setTimestamp();
        
        for (let i = 0; i < top10.length; i++) {
            const r = top10[i];
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
            embed.addFields({
                name: `${medal} ${r.name}`,
                value: `⭐ Média: ${r.averageScore}/10 | 📝 ${r.totalReviews} avaliações`,
                inline: false
            });
        }
        
        await message.reply({ embeds: [embed] });
    }
    
    else if (command === 'stats') {
        const target = message.mentions.users.first() || message.author;
        const stats = calculateUserStats(target.id);
        
        if (stats.count === 0) {
            return message.reply(`📊 Nenhuma avaliação encontrada para ${target.tag}.`);
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`📊 Estatísticas de ${target.tag}`)
            .setColor(getColorByScore(stats.average))
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '📝 Total de avaliações', value: stats.count.toString(), inline: true },
                { name: '⭐ Média', value: stats.average.toString(), inline: true },
                { name: '📈 Melhor nota', value: stats.highest.toString(), inline: true },
                { name: '📉 Pior nota', value: stats.lowest.toString(), inline: true }
            )
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    }
});

// ============================================
// LIMPEZA PERIÓDICA
// ============================================

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of client.tempReviewData) {
        if (value.timestamp && now - value.timestamp > 30 * 60 * 1000) {
            client.tempReviewData.delete(key);
        }
    }
}, 5 * 60 * 1000);

// Limpeza de dados antigos (a cada 24 horas)
setInterval(() => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const reviews = loadReviews();
    const newReviews = reviews.filter(r => new Date(r.createdAt) > sixMonthsAgo);
    if (newReviews.length !== reviews.length) {
        saveReviews(newReviews);
        console.log(`🧹 Limpeza: ${reviews.length - newReviews.length} avaliações antigas removidas`);
    }
}, 24 * 60 * 60 * 1000);

// ============================================
// TRATAMENTO DE ERROS
// ============================================

process.on('unhandledRejection', (error) => {
    console.error('❌ Promise rejection não tratada:', error);
    addLog({ type: 'ERROR', error: error.message, stack: error.stack });
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exceção não capturada:', error);
    addLog({ type: 'FATAL', error: error.message, stack: error.stack });
});

// ============================================
// INICIALIZAÇÃO
// ============================================

console.log('='.repeat(60));
console.log('🚀 INICIANDO BOT DE AVALIAÇÃO v5.0');
console.log('='.repeat(60));
console.log(`🎯 GUILD_ID: ${GUILD_ID}`);
console.log(`🔧 Cargos Staff: ${STAFF_ROLE_IDS.length > 0 ? STAFF_ROLE_IDS.join(', ') : 'NENHUM CONFIGURADO'}`);
console.log(`📺 REVIEWS_CHANNEL_ID: ${REVIEWS_CHANNEL_ID || 'NÃO CONFIGURADO'}`);
console.log(`📝 REVIEWS_LOG_CHANNEL_ID: ${REVIEWS_LOG_CHANNEL_ID || 'NÃO CONFIGURADO'}`);
console.log(`📊 LOG_CHANNEL_ID: ${LOG_CHANNEL_ID || 'NÃO CONFIGURADO'}`);
console.log('='.repeat(60));

client.login(TOKEN).catch(error => {
    console.error('❌ Erro ao fazer login:', error);
    process.exit(1);
});

module.exports = { client, isStaff, canReview, getColorByScore, getScoreEmoji, createBackup };
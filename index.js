// ============================================
// index.js - Bot Discord com Sistema de Avaliação
// ============================================

require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, Collection, PermissionsBitField } = require('discord.js');
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
const STAFF_ROLE_IDS = process.env.STAFF_ROLE_IDS ? process.env.STAFF_ROLE_IDS.split(',').map(id => id.trim()) : [];
const REVIEWS_CHANNEL_ID = process.env.REVIEWS_CHANNEL_ID;
const REVIEWS_LOG_CHANNEL_ID = process.env.REVIEWS_LOG_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

// ============================================
// SISTEMA DE ARMAZENAMENTO EM ARQUIVO JSON
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');
const RANKINGS_FILE = path.join(DATA_DIR, 'rankings.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

// Garantir que o diretório existe
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Funções para ler/escrever dados
function loadReviews() {
    if (!fs.existsSync(REVIEWS_FILE)) {
        fs.writeFileSync(REVIEWS_FILE, JSON.stringify([], null, 2));
        return [];
    }
    const data = fs.readFileSync(REVIEWS_FILE, 'utf-8');
    return JSON.parse(data);
}

function saveReviews(reviews) {
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2));
}

function loadRankings() {
    if (!fs.existsSync(RANKINGS_FILE)) {
        fs.writeFileSync(RANKINGS_FILE, JSON.stringify([], null, 2));
        return [];
    }
    const data = fs.readFileSync(RANKINGS_FILE, 'utf-8');
    return JSON.parse(data);
}

function saveRankings(rankings) {
    fs.writeFileSync(RANKINGS_FILE, JSON.stringify(rankings, null, 2));
}

function loadStats() {
    if (!fs.existsSync(STATS_FILE)) {
        fs.writeFileSync(STATS_FILE, JSON.stringify({ reviews: 0, users: {}, lastWeeklyReset: null }, null, 2));
        return { reviews: 0, users: {}, lastWeeklyReset: null };
    }
    const data = fs.readFileSync(STATS_FILE, 'utf-8');
    return JSON.parse(data);
}

function saveStats(stats) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function loadLogs() {
    if (!fs.existsSync(LOGS_FILE)) {
        fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2));
        return [];
    }
    const data = fs.readFileSync(LOGS_FILE, 'utf-8');
    return JSON.parse(data);
}

function saveLogs(logs) {
    // Manter apenas últimos 1000 logs
    if (logs.length > 1000) {
        logs = logs.slice(-1000);
    }
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
}

function addLog(logEntry) {
    const logs = loadLogs();
    logs.push({
        ...logEntry,
        timestamp: new Date().toISOString()
    });
    saveLogs(logs);
}

// ============================================
// FUNÇÕES DE UTILIDADE
// ============================================

// Verificar se usuário é staff (qualquer um dos cargos)
function isStaff(member) {
    if (!member) return false;
    return STAFF_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

// Obter cor baseada na nota
function getColorByScore(score) {
    if (score >= 0 && score <= 3) return 0xFF0000; // Vermelho
    if (score >= 4 && score <= 6) return 0xFFFF00; // Amarelo
    return 0x00FF00; // Verde
}

// Obter emoji baseado na nota
function getScoreEmoji(score) {
    if (score >= 0 && score <= 3) return '🔴';
    if (score >= 4 && score <= 6) return '🟡';
    return '🟢';
}

// Formatar data
function formatDate(date) {
    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(date));
}

// Obter número da semana
function getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// Calcular estatísticas de um usuário
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
        lowest: Math.min(...scores)
    };
}

// ============================================
// SISTEMA DE RANKING SEMANAL
// ============================================

async function generateWeeklyRanking() {
    const reviews = loadReviews();
    const now = new Date();
    const weekNumber = getWeekNumber(now);
    const year = now.getFullYear();
    
    // Filtrar avaliações da semana atual
    const weekReviews = reviews.filter(review => {
        const reviewDate = new Date(review.createdAt);
        return getWeekNumber(reviewDate) === weekNumber && reviewDate.getFullYear() === year;
    });
    
    if (weekReviews.length === 0) {
        return null;
    }
    
    // Agrupar por usuário avaliado
    const userScores = new Map();
    
    weekReviews.forEach(review => {
        if (!userScores.has(review.reviewedId)) {
            userScores.set(review.reviewedId, {
                userId: review.reviewedId,
                userName: review.reviewedName,
                scores: [],
                totalScore: 0,
                count: 0
            });
        }
        const userData = userScores.get(review.reviewedId);
        userData.scores.push(review.score);
        userData.totalScore += review.score;
        userData.count++;
    });
    
    // Calcular médias e ordenar
    const rankings = [];
    for (const [userId, data] of userScores) {
        const averageScore = data.totalScore / data.count;
        rankings.push({
            userId: data.userId,
            userName: data.userName,
            averageScore: parseFloat(averageScore.toFixed(2)),
            totalReviews: data.count,
            highestScore: Math.max(...data.scores),
            lowestScore: Math.min(...data.scores)
        });
    }
    
    rankings.sort((a, b) => b.averageScore - a.averageScore);
    const top3 = rankings.slice(0, 3);
    
    // Salvar ranking
    const rankingsData = loadRankings();
    rankingsData.push({
        weekNumber,
        year,
        weekStart: new Date(now.setDate(now.getDate() - now.getDay())),
        weekEnd: new Date(now.setDate(now.getDate() - now.getDay() + 6)),
        rankings: top3,
        createdAt: new Date().toISOString()
    });
    saveRankings(rankingsData);
    
    return top3;
}

async function sendWeeklyRanking() {
    const top3 = await generateWeeklyRanking();
    
    if (!top3 || top3.length === 0) {
        return;
    }
    
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) {
        console.error('❌ Canal de logs não encontrado');
        return;
    }
    
    const embed = new EmbedBuilder()
        .setTitle('🏆 Ranking Semanal da Equipe')
        .setDescription('Os 3 membros mais bem avaliados desta semana:')
        .setColor(0xFFD700)
        .setTimestamp()
        .setFooter({ text: 'Sistema de Avaliação Automático' });
    
    const medals = ['🥇', '🥈', '🥉'];
    const medalColors = [0xFFD700, 0xC0C0C0, 0xCD7F32];
    
    for (let i = 0; i < top3.length; i++) {
        const member = top3[i];
        embed.addFields({
            name: `${medals[i]} ${i + 1}º Lugar - ${member.userName}`,
            value: `**Média:** ${member.averageScore}/10\n**Total de avaliações:** ${member.totalReviews}\n**Maior nota:** ${member.highestScore} | **Menor nota:** ${member.lowestScore}`,
            inline: false
        });
    }
    
    // Adicionar menções honrosas
    if (top3.length > 0) {
        const best = top3[0];
        embed.setThumbnail('https://cdn.discordapp.com/emojis/890915467471437854.png');
    }
    
    await logChannel.send({ embeds: [embed] });
    
    // Adicionar log
    addLog({
        type: 'WEEKLY_RANKING',
        weekNumber: getWeekNumber(new Date()),
        top3: top3.map(t => ({ userId: t.userId, userName: t.userName, averageScore: t.averageScore }))
    });
}

// Verificar se precisa enviar ranking (todo domingo às 23:59)
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

// Comando /clearall
const clearAllCommand = new SlashCommandBuilder()
    .setName('clearall')
    .setDescription('Apaga todas as mensagens de um canal específico')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('Canal que terá as mensagens apagadas')
            .setRequired(true)
            .addChannelTypes(0))
    .addIntegerOption(option =>
        option.setName('limit')
            .setDescription('Quantidade de mensagens para apagar (padrão: 100, máximo: 1000)')
            .setMinValue(1)
            .setMaxValue(1000)
            .setRequired(false));

// Comando /clear
const clearCommand = new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Apaga todas as mensagens de um usuário específico')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('Usuário que terá as mensagens apagadas')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('limit')
            .setDescription('Quantidade de mensagens para apagar (padrão: 100, máximo: 500)')
            .setMinValue(1)
            .setMaxValue(500)
            .setRequired(false));

// Comando /stats (adicional)
const statsCommand = new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Mostra estatísticas do sistema de avaliação')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('Usuário para ver estatísticas (opcional)')
            .setRequired(false));

// Comando /ranking (adicional)
const rankingCommand = new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Mostra o ranking atual da semana');

// Registrar comandos
const commands = [clearAllCommand, clearCommand, statsCommand, rankingCommand];

// ============================================
// EVENTOS DO BOT
// ============================================

client.once('ready', async () => {
    console.log(`🤖 Bot logado como ${client.user.tag}`);
    console.log(`📋 Cargos Staff configurados: ${STAFF_ROLE_IDS.length}`);
    console.log(`📺 Canal de avaliações: ${REVIEWS_CHANNEL_ID}`);
    console.log(`📝 Canal de logs de avaliações: ${REVIEWS_LOG_CHANNEL_ID}`);
    console.log(`📊 Canal de logs gerais: ${LOG_CHANNEL_ID}`);
    
    try {
        // Registrar comandos slash
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log('✅ Comandos slash registrados globalmente');
        
        // Configurar canal de avaliações
        await setupReviewsChannel();
        
        // Iniciar verificação de ranking semanal (verificar a cada hora)
        setInterval(() => {
            checkAndSendRanking();
        }, 60 * 60 * 1000);
        
        // Verificar imediatamente
        checkAndSendRanking();
        
        // Atualizar status
        updateStatus();
        
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
});

// Configurar canal de avaliações
async function setupReviewsChannel() {
    const channel = client.channels.cache.get(REVIEWS_CHANNEL_ID);
    if (!channel) {
        console.error('❌ Canal de avaliações não encontrado! Verifique REVIEWS_CHANNEL_ID');
        return;
    }
    
    // Buscar cargos staff para exibir
    const guild = channel.guild;
    const staffRolesInfo = [];
    
    for (const roleId of STAFF_ROLE_IDS) {
        const role = guild.roles.cache.get(roleId);
        if (role) {
            const members = role.members.map(m => `• ${m.user.tag}`).join('\n');
            staffRolesInfo.push({
                name: role.name,
                memberCount: role.members.size,
                members: members || 'Nenhum membro'
            });
        }
    }
    
    const embed = new EmbedBuilder()
        .setTitle('📊 Sistema de Avaliação da Equipe')
        .setDescription('Clique no botão abaixo para avaliar um membro da nossa equipe!')
        .setColor('#341539')
        .addFields(
            { name: '📋 Como funciona', value: '1️⃣ Selecione o cargo do membro\n2️⃣ Escolha o membro que deseja avaliar\n3️⃣ Selecione uma nota de 0 a 10\n4️⃣ Escreva seu feedback (opcional, máx. 700 caracteres)\n5️⃣ Envie sua avaliação', inline: false },
            { name: '🎯 Quem pode avaliar', value: `Apenas membros com um dos seguintes cargos podem avaliar:\n${staffRolesInfo.map(r => `• ${r.name}`).join('\n')}`, inline: false },
            { name: '⭐ Sistema de Notas', value: '🔴 0-3: Insatisfatório\n🟡 4-6: Regular\n🟢 7-10: Excelente', inline: false }
        )
        .setFooter({ text: 'Sistema de Avaliação Automático • Sua opinião é importante!' })
        .setTimestamp();
    
    const button = new ButtonBuilder()
        .setCustomId('open_review_menu')
        .setLabel('🛠 Avaliar equipe')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('⭐');
    
    const row = new ActionRowBuilder().addComponents(button);
    
    // Limpar mensagens antigas
    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMessages = messages.filter(m => m.author.id === client.user.id);
        for (const msg of botMessages.values()) {
            await msg.delete().catch(() => {});
        }
    } catch (error) {
        console.error('Erro ao limpar mensagens antigas:', error);
    }
    
    await channel.send({ embeds: [embed], components: [row] });
    console.log('✅ Canal de avaliações configurado');
}

// Atualizar status do bot
function updateStatus() {
    const activities = [
        { name: `${STAFF_ROLE_IDS.length} cargos da staff`, type: 3 },
        { name: '/clearall | /clear', type: 2 },
        { name: 'Sistema de Avaliação', type: 3 },
        { name: 'Avalie sua equipe!', type: 2 }
    ];
    
    let index = 0;
    setInterval(() => {
        const activity = activities[index % activities.length];
        client.user.setPresence({
            activities: [{ name: activity.name, type: activity.type }],
            status: 'online'
        });
        index++;
    }, 10000);
}

// ============================================
// HANDLER DE INTERAÇÕES
// ============================================

client.on('interactionCreate', async interaction => {
    // Comandos Slash
    if (interaction.isCommand()) {
        const { commandName, member, options } = interaction;
        
        // Verificar permissão para comandos de moderação
        if (commandName === 'clearall' || commandName === 'clear') {
            if (!isStaff(member)) {
                return interaction.reply({
                    content: '❌ Você não tem permissão para usar este comando! Apenas membros da staff podem usar.',
                    ephemeral: true
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
                    ephemeral: true
                });
            }
            
            await interaction.reply({
                content: `🔄 Apagando até ${limit} mensagens do canal ${channel}...`,
                ephemeral: true
            });
            
            try {
                let deletedCount = 0;
                let fetched;
                let remaining = limit;
                
                while (remaining > 0) {
                    const fetchLimit = Math.min(remaining, 100);
                    fetched = await channel.messages.fetch({ limit: fetchLimit });
                    
                    if (fetched.size === 0) break;
                    
                    const deleted = await channel.bulkDelete(fetched, true);
                    deletedCount += deleted.size;
                    remaining -= deleted.size;
                    
                    if (fetched.size < fetchLimit) break;
                }
                
                await interaction.editReply({
                    content: `✅ ${deletedCount} mensagens foram apagadas do canal ${channel}!`
                });
                
                // Log da ação
                const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('📝 Ação de Moderação')
                        .setColor(0xFFA500)
                        .addFields(
                            { name: '👮 Ação', value: 'Limpeza de Canal', inline: true },
                            { name: '👤 Staff', value: member.user.tag, inline: true },
                            { name: '📺 Canal', value: channel.toString(), inline: true },
                            { name: '🗑️ Mensagens', value: deletedCount.toString(), inline: true }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
                
                addLog({
                    type: 'CLEAR_ALL',
                    moderator: member.user.tag,
                    channelId: channel.id,
                    channelName: channel.name,
                    messageCount: deletedCount
                });
                
            } catch (error) {
                console.error(error);
                await interaction.editReply({
                    content: '❌ Erro ao apagar mensagens! Mensagens podem ser muito antigas (mais de 14 dias) ou você não tem permissão.'
                });
            }
        }
        
        // Comando /clear
        else if (commandName === 'clear') {
            const targetUser = options.getUser('user');
            const limit = options.getInteger('limit') || 100;
            const channel = interaction.channel;
            
            await interaction.reply({
                content: `🔄 Apagando até ${limit} mensagens de ${targetUser.tag}...`,
                ephemeral: true
            });
            
            try {
                let deletedCount = 0;
                let fetched;
                let remaining = limit;
                
                while (remaining > 0) {
                    const fetchLimit = Math.min(remaining, 100);
                    fetched = await channel.messages.fetch({ limit: fetchLimit });
                    const messagesToDelete = fetched.filter(msg => msg.author.id === targetUser.id);
                    
                    if (messagesToDelete.size === 0) break;
                    
                    const deleted = await channel.bulkDelete(messagesToDelete, true);
                    deletedCount += deleted.size;
                    remaining -= deleted.size;
                }
                
                await interaction.editReply({
                    content: `✅ ${deletedCount} mensagens de ${targetUser.tag} foram apagadas!`
                });
                
                // Log da ação
                const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('📝 Ação de Moderação')
                        .setColor(0xFFA500)
                        .addFields(
                            { name: '👮 Ação', value: 'Limpeza de Usuário', inline: true },
                            { name: '👤 Staff', value: member.user.tag, inline: true },
                            { name: '🎯 Alvo', value: targetUser.tag, inline: true },
                            { name: '🗑️ Mensagens', value: deletedCount.toString(), inline: true }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
                
                addLog({
                    type: 'CLEAR_USER',
                    moderator: member.user.tag,
                    targetUser: targetUser.tag,
                    channelId: channel.id,
                    messageCount: deletedCount
                });
                
            } catch (error) {
                console.error(error);
                await interaction.editReply({
                    content: '❌ Erro ao apagar mensagens! Mensagens podem ser muito antigas (mais de 14 dias).'
                });
            }
        }
        
        // Comando /stats
        else if (commandName === 'stats') {
            const targetUser = options.getUser('user') || interaction.user;
            const stats = calculateUserStats(targetUser.id);
            
            const embed = new EmbedBuilder()
                .setTitle(`📊 Estatísticas de ${targetUser.tag}`)
                .setColor('#341539')
                .addFields(
                    { name: '📝 Total de avaliações recebidas', value: stats.count.toString(), inline: true },
                    { name: '⭐ Média de notas', value: stats.average.toString(), inline: true },
                    { name: '📈 Maior nota', value: stats.highest.toString(), inline: true },
                    { name: '📉 Menor nota', value: stats.lowest.toString(), inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Sistema de Avaliação' });
            
            await interaction.reply({ embeds: [embed] });
        }
        
        // Comando /ranking
        else if (commandName === 'ranking') {
            const reviews = loadReviews();
            const now = new Date();
            const weekNumber = getWeekNumber(now);
            const year = now.getFullYear();
            
            const weekReviews = reviews.filter(review => {
                const reviewDate = new Date(review.createdAt);
                return getWeekNumber(reviewDate) === weekNumber && reviewDate.getFullYear() === year;
            });
            
            if (weekReviews.length === 0) {
                return interaction.reply({
                    content: '📊 Nenhuma avaliação foi feita esta semana ainda!',
                    ephemeral: true
                });
            }
            
            const userScores = new Map();
            weekReviews.forEach(review => {
                if (!userScores.has(review.reviewedId)) {
                    userScores.set(review.reviewedId, {
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
                    userName: data.userName,
                    averageScore: parseFloat((data.totalScore / data.count).toFixed(2)),
                    totalReviews: data.count
                });
            }
            
            rankings.sort((a, b) => b.averageScore - a.averageScore);
            const top5 = rankings.slice(0, 5);
            
            const embed = new EmbedBuilder()
                .setTitle('🏆 Ranking da Semana')
                .setDescription(`Semana ${weekNumber} de ${year}`)
                .setColor(0xFFD700)
                .setTimestamp();
            
            const medals = ['🥇', '🥈', '🥉', '📊', '📊'];
            for (let i = 0; i < top5.length; i++) {
                const r = top5[i];
                embed.addFields({
                    name: `${medals[i]} ${i + 1}º - ${r.userName}`,
                    value: `⭐ Média: ${r.averageScore}/10 | 📝 ${r.totalReviews} avaliação(ões)`,
                    inline: false
                });
            }
            
            await interaction.reply({ embeds: [embed] });
        }
    }
    
    // Botões
    if (interaction.isButton() && interaction.customId === 'open_review_menu') {
        const member = interaction.member;
        
        if (!isStaff(member)) {
            return interaction.reply({
                content: '❌ Apenas membros da staff podem avaliar outros membros!',
                ephemeral: true
            });
        }
        
        const guild = interaction.guild;
        const rolesWithMembers = [];
        
        for (const roleId of STAFF_ROLE_IDS) {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                const membersList = role.members.filter(m => m.id !== interaction.user.id);
                if (membersList.size > 0) {
                    rolesWithMembers.push({
                        id: role.id,
                        name: role.name,
                        memberCount: membersList.size,
                        members: membersList
                    });
                }
            }
        }
        
        if (rolesWithMembers.length === 0) {
            return interaction.reply({
                content: '❌ Nenhum outro membro da staff disponível para avaliação!',
                ephemeral: true
            });
        }
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_role')
            .setPlaceholder('📌 Selecione um cargo para avaliar')
            .addOptions(
                rolesWithMembers.map(role => ({
                    label: role.name,
                    value: role.id,
                    description: `${role.memberCount} membro(s) neste cargo`,
                    emoji: '👥'
                }))
            );
        
        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        await interaction.reply({
            content: '**📋 Selecione o cargo do membro que deseja avaliar:**',
            components: [row],
            ephemeral: true
        });
    }
    
    // Menu de seleção de cargo
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_role') {
        const selectedRoleId = interaction.values[0];
        const guild = interaction.guild;
        const role = guild.roles.cache.get(selectedRoleId);
        
        if (!role) {
            return interaction.update({
                content: '❌ Cargo não encontrado!',
                components: [],
                ephemeral: true
            });
        }
        
        const members = role.members.filter(m => m.id !== interaction.user.id);
        
        if (members.size === 0) {
            return interaction.update({
                content: '❌ Não há membros neste cargo para avaliar!',
                components: [],
                ephemeral: true
            });
        }
        
        const userSelectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_user')
            .setPlaceholder('👤 Selecione o usuário para avaliar')
            .addOptions(
                members.map(member => ({
                    label: member.user.tag.length > 25 ? member.user.tag.substring(0, 22) + '...' : member.user.tag,
                    value: member.id,
                    description: `Avaliar ${member.user.displayName}`,
                    emoji: '⭐'
                })).slice(0, 25)
            );
        
        const row = new ActionRowBuilder().addComponents(userSelectMenu);
        
        await interaction.update({
            content: `**📌 Cargo selecionado:** ${role.name}\n**👤 Selecione o usuário para avaliar:**`,
            components: [row],
            ephemeral: true
        });
    }
    
    // Menu de seleção de usuário
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_user') {
        const selectedUserId = interaction.values[0];
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(selectedUserId).catch(() => null);
        
        if (!targetMember) {
            return interaction.update({
                content: '❌ Usuário não encontrado!',
                components: [],
                ephemeral: true
            });
        }
        
        if (targetMember.id === interaction.user.id) {
            return interaction.update({
                content: '❌ Você não pode avaliar a si mesmo!',
                components: [],
                ephemeral: true
            });
        }
        
        // Criar modal para nota e feedback
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
            .setMaxLength(700);
        
        const firstRow = new ActionRowBuilder().addComponents(scoreInput);
        const secondRow = new ActionRowBuilder().addComponents(feedbackInput);
        
        modal.addComponents(firstRow, secondRow);
        
        // Armazenar dados temporários
        client.tempReviewData.set(interaction.user.id, {
            targetId: selectedUserId,
            targetName: targetMember.user.tag,
            targetDisplayName: targetMember.user.displayName
        });
        
        await interaction.showModal(modal);
    }
    
    // Modal de avaliação
    if (interaction.isModalSubmit() && interaction.customId.startsWith('review_modal_')) {
        const targetId = interaction.customId.replace('review_modal_', '');
        const score = parseInt(interaction.fields.getTextInputValue('score'));
        const feedback = interaction.fields.getTextInputValue('feedback') || 'Sem feedback fornecido';
        
        // Validar nota
        if (isNaN(score) || score < 0 || score > 10) {
            return interaction.reply({
                content: '❌ Nota inválida! Por favor, insira um número entre 0 e 10.',
                ephemeral: true
            });
        }
        
        const tempData = client.tempReviewData.get(interaction.user.id);
        if (!tempData || tempData.targetId !== targetId) {
            return interaction.reply({
                content: '❌ Sessão expirada! Por favor, inicie uma nova avaliação clicando no botão novamente.',
                ephemeral: true
            });
        }
        
        const guild = interaction.guild;
        const reviewer = interaction.user;
        const reviewed = await guild.members.fetch(targetId).catch(() => null);
        
        if (!reviewed) {
            return interaction.reply({
                content: '❌ Usuário avaliado não encontrado!',
                ephemeral: true
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
        stats.reviews++;
        if (!stats.users[reviewed.id]) {
            stats.users[reviewed.id] = { name: reviewed.user.tag, reviews: 0, totalScore: 0 };
        }
        stats.users[reviewed.id].reviews++;
        stats.users[reviewed.id].totalScore += score;
        saveStats(stats);
        
        // Criar embed para o canal de logs
        const color = getColorByScore(score);
        const scoreEmoji = getScoreEmoji(score);
        
        const logEmbed = new EmbedBuilder()
            .setTitle(`${scoreEmoji} Nova Avaliação`)
            .setColor(color)
            .addFields(
                { name: '👤 Avaliador', value: `<@${reviewer.id}>`, inline: true },
                { name: '⭐ Avaliado', value: `<@${reviewed.id}>`, inline: true },
                { name: '🎯 Nota', value: `${score}/10`, inline: true },
                { name: '💬 Feedback', value: feedback.length > 1024 ? feedback.substring(0, 1021) + '...' : feedback, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `ID: ${newReview.id}` });
        
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
                { name: 'Nota atribuída', value: `${score}/10`, inline: true },
                { name: 'Feedback', value: feedback.length > 100 ? feedback.substring(0, 97) + '...' : feedback, inline: false }
            )
            .setTimestamp();
        
        await interaction.reply({
            embeds: [successEmbed],
            ephemeral: true
        });
        
        // Adicionar ao log geral
        addLog({
            type: 'REVIEW_CREATED',
            reviewer: reviewer.tag,
            reviewed: reviewed.user.tag,
            score: score,
            feedbackLength: feedback.length
        });
    }
});

// ============================================
// SISTEMA DE LOGS E MONITORAMENTO
// ============================================

// Logger para ações do bot
class BotLogger {
    static async info(message, details = {}) {
        console.log(`ℹ️ [INFO] ${message}`, details);
        addLog({ level: 'INFO', message, details });
    }
    
    static async warn(message, details = {}) {
        console.warn(`⚠️ [WARN] ${message}`, details);
        addLog({ level: 'WARN', message, details });
    }
    
    static async error(message, details = {}) {
        console.error(`❌ [ERROR] ${message}`, details);
        addLog({ level: 'ERROR', message, details });
    }
    
    static async success(message, details = {}) {
        console.log(`✅ [SUCCESS] ${message}`, details);
        addLog({ level: 'SUCCESS', message, details });
    }
}

// ============================================
// COMANDOS DE TEXTO ADICIONAIS
// ============================================

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;
    
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    // Comando !help
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('📚 Comandos Disponíveis')
            .setColor('#341539')
            .addFields(
                { name: '/clearall', value: 'Apaga todas as mensagens de um canal (Staff apenas)', inline: false },
                { name: '/clear', value: 'Apaga mensagens de um usuário específico (Staff apenas)', inline: false },
                { name: '/stats', value: 'Mostra estatísticas de um usuário', inline: false },
                { name: '/ranking', value: 'Mostra o ranking da semana', inline: false },
                { name: '!ping', value: 'Verifica a latência do bot', inline: false },
                { name: '!info', value: 'Mostra informações do bot', inline: false }
            )
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    }
    
    // Comando !ping
    else if (command === 'ping') {
        const sent = await message.reply('🏓 Pong!');
        const latency = sent.createdTimestamp - message.createdTimestamp;
        await sent.edit(`🏓 Pong! Latência: ${latency}ms | API: ${Math.round(client.ws.ping)}ms`);
    }
    
    // Comando !info
    else if (command === 'info') {
        const reviews = loadReviews();
        const stats = loadStats();
        
        const embed = new EmbedBuilder()
            .setTitle('🤖 Informações do Bot')
            .setDescription('Bot de avaliação para equipes Discord')
            .setColor('#341539')
            .addFields(
                { name: '📊 Total de avaliações', value: reviews.length.toString(), inline: true },
                { name: '👥 Usuários avaliados', value: Object.keys(stats.users).length.toString(), inline: true },
                { name: '🔧 Cargos Staff', value: STAFF_ROLE_IDS.length.toString(), inline: true },
                { name: '⏰ Uptime', value: `${Math.floor(process.uptime() / 86400)}d ${Math.floor((process.uptime() % 86400) / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`, inline: true },
                { name: '📡 Servidores', value: client.guilds.cache.size.toString(), inline: true }
            )
            .setFooter({ text: `Bot criado para ${client.user.tag}` })
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    }
    
    // Comando !top
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
    
    // Comando !review (para ver avaliações de um usuário)
    else if (command === 'review') {
        const target = message.mentions.users.first();
        if (!target) {
            return message.reply('❌ Por favor, mencione um usuário para ver as avaliações! Ex: `!review @usuario`');
        }
        
        const reviews = loadReviews();
        const userReviews = reviews.filter(r => r.reviewedId === target.id);
        
        if (userReviews.length === 0) {
            return message.reply(`📊 Nenhuma avaliação encontrada para ${target.tag}.`);
        }
        
        const stats = calculateUserStats(target.id);
        
        const embed = new EmbedBuilder()
            .setTitle(`📝 Avaliações de ${target.tag}`)
            .setColor(getColorByScore(stats.average))
            .addFields(
                { name: '📊 Total de avaliações', value: stats.count.toString(), inline: true },
                { name: '⭐ Média', value: stats.average.toString(), inline: true },
                { name: '📈 Melhor nota', value: stats.highest.toString(), inline: true },
                { name: '📉 Pior nota', value: stats.lowest.toString(), inline: true }
            )
            .setTimestamp();
        
        // Adicionar últimas 5 avaliações
        const last5 = userReviews.slice(-5).reverse();
        if (last5.length > 0) {
            const reviewsText = last5.map(r => {
                const emoji = getScoreEmoji(r.score);
                return `${emoji} **${r.score}/10** - ${r.feedback.substring(0, 50)}${r.feedback.length > 50 ? '...' : ''} (por ${r.reviewerName})`;
            }).join('\n\n');
            
            embed.addFields({ name: '📋 Últimas avaliações', value: reviewsText, inline: false });
        }
        
        await message.reply({ embeds: [embed] });
    }
});

// ============================================
// SISTEMA DE BACKUP AUTOMÁTICO
// ============================================

function createBackup() {
    const backupDir = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupData = {
        timestamp: new Date().toISOString(),
        reviews: loadReviews(),
        rankings: loadRankings(),
        stats: loadStats(),
        logs: loadLogs().slice(-100) // Últimos 100 logs
    };
    
    const backupFile = path.join(backupDir, `backup_${timestamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    
    // Limpar backups antigos (manter apenas últimos 10)
    const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.json')).sort();
    while (backups.length > 10) {
        const oldBackup = backups.shift();
        fs.unlinkSync(path.join(backupDir, oldBackup));
    }
    
    BotLogger.success(`Backup criado: ${path.basename(backupFile)}`);
    return backupFile;
}

// Backup diário às 03:00
setInterval(() => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 0) {
        createBackup();
    }
}, 60 * 1000);

// ============================================
// TRATAMENTO DE ERROS E ANTI-CRASH
// ============================================

process.on('unhandledRejection', (error) => {
    console.error('❌ Erro não tratado (Promise):', error);
    addLog({ type: 'ERROR', error: error.message, stack: error.stack });
});

process.on('uncaughtException', (error) => {
    console.error('❌ Erro não tratado (Exception):', error);
    addLog({ type: 'FATAL', error: error.message, stack: error.stack });
});

// Limpeza periódica de dados temporários
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of client.tempReviewData) {
        // Remover dados temporários com mais de 30 minutos
        if (value.timestamp && now - value.timestamp > 30 * 60 * 1000) {
            client.tempReviewData.delete(key);
        } else if (!value.timestamp) {
            value.timestamp = now;
        }
    }
}, 5 * 60 * 1000);

// ============================================
// INICIALIZAÇÃO DO BOT
// ============================================

client.login(TOKEN).then(() => {
    console.log('='.repeat(50));
    console.log('🚀 BOT INICIADO COM SUCESSO!');
    console.log('='.repeat(50));
    console.log(`📋 Cargos Staff: ${STAFF_ROLE_IDS.join(', ') || 'Nenhum'}`);
    console.log(`📺 Canal de Avaliações: ${REVIEWS_CHANNEL_ID}`);
    console.log(`📝 Canal de Logs Avaliações: ${REVIEWS_LOG_CHANNEL_ID}`);
    console.log(`📊 Canal de Logs Gerais: ${LOG_CHANNEL_ID}`);
    console.log('='.repeat(50));
    
    // Criar backup inicial
    setTimeout(() => {
        createBackup();
    }, 5000);
}).catch(error => {
    console.error('❌ Erro ao fazer login:', error);
    process.exit(1);
});

// ============================================
// EXPORTS PARA TESTES
// ============================================

module.exports = {
    client,
    isStaff,
    getColorByScore,
    getScoreEmoji,
    calculateUserStats,
    generateWeeklyRanking,
    createBackup,
    loadReviews,
    saveReviews,
    addLog
};

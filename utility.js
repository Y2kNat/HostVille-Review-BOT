// index.js - Arquivo principal do bot
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// Configuração do Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Collections para comandos
client.commands = new Collection();
client.slashCommands = new Collection();

// Variáveis de ambiente
const TOKEN = process.env.TOKEN;
const STAFF_ROLE_IDS = process.env.STAFF_ROLE_IDS ? process.env.STAFF_ROLE_IDS.split(',') : [];
const REVIEWS_CHANNEL_ID = process.env.REVIEWS_CHANNEL_ID;
const REVIEWS_LOG_CHANNEL_ID = process.env.REVIEWS_LOG_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const MONGODB_URI = process.env.MONGODB_URI;

// Schema para avaliações
const ReviewSchema = new mongoose.Schema({
    reviewerId: { type: String, required: true },
    reviewedId: { type: String, required: true },
    reviewerName: { type: String, required: true },
    reviewedName: { type: String, required: true },
    score: { type: Number, required: true, min: 0, max: 10 },
    feedback: { type: String, required: true, maxlength: 700 },
    createdAt: { type: Date, default: Date.now }
});

const Review = mongoose.model('Review', ReviewSchema);

// Schema para histórico semanal
const WeeklyRankingSchema = new mongoose.Schema({
    weekStart: { type: Date, required: true },
    weekEnd: { type: Date, required: true },
    rankings: [{
        userId: { type: String, required: true },
        userName: { type: String, required: true },
        averageScore: { type: Number, required: true },
        totalReviews: { type: Number, required: true }
    }],
    createdAt: { type: Date, default: Date.now }
});

const WeeklyRanking = mongoose.model('WeeklyRanking', WeeklyRankingSchema);

// Conexão com MongoDB
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ Conectado ao MongoDB');
}).catch(err => {
    console.error('❌ Erro ao conectar ao MongoDB:', err);
    process.exit(1);
});

// Função para verificar se o usuário é staff
function isStaff(member) {
    if (!member) return false;
    return STAFF_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

// Função para obter cor baseada na nota
function getColorByScore(score) {
    if (score >= 0 && score <= 3) return 0xFF0000; // Vermelho
    if (score >= 4 && score <= 6) return 0xFFFF00; // Amarelo
    return 0x00FF00; // Verde
}

// Função para criar embed de avaliação
async function createReviewEmbed(reviewer, reviewed, score, feedback) {
    const color = getColorByScore(score);
    const embed = new EmbedBuilder()
        .setTitle('📝 Nova Avaliação')
        .setColor(color)
        .addFields(
            { name: '👤 Avaliador', value: `<@${reviewer.id}>`, inline: true },
            { name: '⭐ Avaliado', value: `<@${reviewed.id}>`, inline: true },
            { name: '🎯 Nota', value: `${score}/10`, inline: true },
            { name: '💬 Feedback', value: feedback || 'Sem feedback fornecido', inline: false }
        )
        .setTimestamp()
        .setFooter({ text: `ID do Avaliado: ${reviewed.id}` });
    
    return embed;
}

// Comando /clearall
const clearAllCommand = new SlashCommandBuilder()
    .setName('clearall')
    .setDescription('Apaga todas as mensagens de um canal específico')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('Canal que terá as mensagens apagadas')
            .setRequired(true));

// Comando /clear
const clearCommand = new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Apaga todas as mensagens de um usuário específico')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('Usuário que terá as mensagens apagadas')
            .setRequired(true));

// Registrar comandos
const commands = [clearAllCommand, clearCommand];
const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
    console.log(`🤖 Bot logado como ${client.user.tag}`);
    
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log('✅ Comandos slash registrados globalmente');
        
        // Iniciar sistema de ranking semanal
        startWeeklyRankingSystem();
        
        // Criar embed e botão no canal de avaliações
        await setupReviewsChannel();
        
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
});

// Configurar canal de avaliações
async function setupReviewsChannel() {
    const channel = client.channels.cache.get(REVIEWS_CHANNEL_ID);
    if (!channel) {
        console.error('❌ Canal de avaliações não encontrado');
        return;
    }
    
    const embed = new EmbedBuilder()
        .setTitle('📊 Sistema de Avaliação da Equipe')
        .setDescription('Clique no botão abaixo para avaliar um membro da nossa equipe!')
        .setColor('#341539')
        .addFields(
            { name: '📋 Instruções', value: '1. Selecione o membro que deseja avaliar\n2. Escolha uma nota de 0 a 10\n3. Deixe seu feedback (máx. 700 caracteres)\n4. Envie sua avaliação' },
            { name: '🎯 Importante', value: 'Apenas membros da staff podem avaliar outros membros da staff.' }
        )
        .setFooter({ text: 'Sistema de Avaliação Automático' })
        .setTimestamp();
    
    const button = new ButtonBuilder()
        .setCustomId('open_review_menu')
        .setLabel('🛠 Avaliar equipe')
        .setStyle(ButtonStyle.Primary);
    
    const row = new ActionRowBuilder().addComponents(button);
    
    // Limpar mensagens antigas e enviar nova
    const messages = await channel.messages.fetch({ limit: 10 });
    await channel.bulkDelete(messages);
    await channel.send({ embeds: [embed], components: [row] });
}

// Sistema de ranking semanal
async function startWeeklyRankingSystem() {
    // Executar toda semana (Domingo às 23:59)
    cron.schedule('59 23 * * 0', async () => {
        await generateWeeklyRanking();
    });
    
    // Executar também na inicialização para verificar se precisa gerar ranking pendente
    await checkAndGeneratePendingRanking();
}

async function checkAndGeneratePendingRanking() {
    const lastWeekStart = new Date();
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    lastWeekStart.setHours(0, 0, 0, 0);
    
    const existingRanking = await WeeklyRanking.findOne({
        weekStart: { $gte: lastWeekStart }
    });
    
    if (!existingRanking) {
        await generateWeeklyRanking();
    }
}

async function generateWeeklyRanking() {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(now);
    weekEnd.setHours(23, 59, 59, 999);
    
    // Buscar todas as avaliações da última semana
    const reviews = await Review.find({
        createdAt: { $gte: weekStart, $lte: weekEnd }
    });
    
    // Calcular média por usuário
    const userScores = new Map();
    reviews.forEach(review => {
        if (!userScores.has(review.reviewedId)) {
            userScores.set(review.reviewedId, {
                totalScore: 0,
                count: 0,
                userName: review.reviewedName
            });
        }
        const userData = userScores.get(review.reviewedId);
        userData.totalScore += review.score;
        userData.count++;
    });
    
    // Calcular médias e ordenar
    const rankings = [];
    for (const [userId, data] of userScores) {
        const averageScore = data.totalScore / data.count;
        rankings.push({
            userId,
            userName: data.userName,
            averageScore: parseFloat(averageScore.toFixed(2)),
            totalReviews: data.count
        });
    }
    
    rankings.sort((a, b) => b.averageScore - a.averageScore);
    const top3 = rankings.slice(0, 3);
    
    // Salvar no banco
    const weeklyRanking = new WeeklyRanking({
        weekStart,
        weekEnd,
        rankings: top3
    });
    await weeklyRanking.save();
    
    // Enviar para o canal de logs
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel && top3.length > 0) {
        const embed = new EmbedBuilder()
            .setTitle('🏆 Ranking Semanal da Equipe')
            .setDescription('Os 3 membros mais bem avaliados desta semana:')
            .setColor(0xFFD700)
            .setTimestamp();
        
        for (let i = 0; i < top3.length; i++) {
            const member = top3[i];
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
            embed.addFields({
                name: `${medal} ${i + 1}º Lugar`,
                value: `**${member.userName}**\nMédia: ${member.averageScore}/10\nTotal de avaliações: ${member.totalReviews}`,
                inline: false
            });
        }
        
        embed.setFooter({ text: `Período: ${weekStart.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}` });
        await logChannel.send({ embeds: [embed] });
    }
}

// Handler para comandos slash
client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        const { commandName, member, options } = interaction;
        
        // Verificar permissão de staff
        if (!isStaff(member)) {
            return interaction.reply({
                content: '❌ Você não tem permissão para usar este comando!',
                ephemeral: true
            });
        }
        
        if (commandName === 'clearall') {
            const channel = options.getChannel('channel');
            
            if (!channel.isTextBased()) {
                return interaction.reply({
                    content: '❌ Este não é um canal de texto válido!',
                    ephemeral: true
                });
            }
            
            await interaction.reply({
                content: `🔄 Apagando mensagens do canal ${channel}...`,
                ephemeral: true
            });
            
            try {
                let deletedCount = 0;
                let fetched;
                
                do {
                    fetched = await channel.messages.fetch({ limit: 100 });
                    const deleted = await channel.bulkDelete(fetched, true);
                    deletedCount += deleted.size;
                } while (fetched.size >= 2);
                
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
                            { name: 'Ação', value: 'Limpeza de Canal', inline: true },
                            { name: 'Staff', value: member.user.tag, inline: true },
                            { name: 'Canal', value: channel.toString(), inline: true },
                            { name: 'Mensagens Apagadas', value: deletedCount.toString(), inline: true }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
                
            } catch (error) {
                console.error(error);
                await interaction.editReply({
                    content: '❌ Erro ao apagar mensagens! Mensagens podem ser muito antigas (mais de 14 dias).'
                });
            }
            
        } else if (commandName === 'clear') {
            const targetUser = options.getUser('user');
            const channel = interaction.channel;
            
            await interaction.reply({
                content: `🔄 Apagando mensagens de ${targetUser.tag}...`,
                ephemeral: true
            });
            
            try {
                let deletedCount = 0;
                let fetched;
                
                do {
                    fetched = await channel.messages.fetch({ limit: 100 });
                    const messagesToDelete = fetched.filter(msg => msg.author.id === targetUser.id);
                    
                    if (messagesToDelete.size === 0) break;
                    
                    const deleted = await channel.bulkDelete(messagesToDelete, true);
                    deletedCount += deleted.size;
                } while (fetched.size >= 2);
                
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
                            { name: 'Ação', value: 'Limpeza de Usuário', inline: true },
                            { name: 'Staff', value: member.user.tag, inline: true },
                            { name: 'Usuário Alvo', value: targetUser.tag, inline: true },
                            { name: 'Mensagens Apagadas', value: deletedCount.toString(), inline: true }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
                
            } catch (error) {
                console.error(error);
                await interaction.editReply({
                    content: '❌ Erro ao apagar mensagens! Mensagens podem ser muito antigas (mais de 14 dias).'
                });
            }
        }
    }
    
    // Handler para botões
    if (interaction.isButton() && interaction.customId === 'open_review_menu') {
        const member = interaction.member;
        
        if (!isStaff(member)) {
            return interaction.reply({
                content: '❌ Apenas membros da staff podem avaliar outros membros!',
                ephemeral: true
            });
        }
        
        // Criar menu de seleção de cargos
        const guild = interaction.guild;
        const roles = [];
        
        for (const roleId of STAFF_ROLE_IDS) {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                const membersWithRole = role.members.map(m => ({
                    id: m.id,
                    name: m.user.tag,
                    label: m.user.tag.substring(0, 25)
                }));
                
                if (membersWithRole.length > 0) {
                    roles.push({
                        roleName: role.name,
                        roleId: role.id,
                        members: membersWithRole
                    });
                }
            }
        }
        
        if (roles.length === 0) {
            return interaction.reply({
                content: '❌ Nenhum cargo da staff encontrado!',
                ephemeral: true
            });
        }
        
        // Criar menu de seleção de cargos
        const roleSelectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_role')
            .setPlaceholder('Selecione um cargo')
            .addOptions(
                roles.map(role => ({
                    label: role.roleName,
                    value: role.roleId,
                    description: `${role.members.length} membro(s) neste cargo`
                }))
            );
        
        const roleRow = new ActionRowBuilder().addComponents(roleSelectMenu);
        
        await interaction.reply({
            content: '**Selecione o cargo do membro que deseja avaliar:**',
            components: [roleRow],
            ephemeral: true
        });
    }
    
    // Handler para seleção de cargos
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
        
        // Criar menu de seleção de usuários
        const userSelectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_user')
            .setPlaceholder('Selecione o usuário para avaliar')
            .addOptions(
                members.map(member => ({
                    label: member.user.tag.substring(0, 25),
                    value: member.id,
                    description: `Avaliar ${member.user.tag}`
                })).slice(0, 25)
            );
        
        const userRow = new ActionRowBuilder().addComponents(userSelectMenu);
        
        await interaction.update({
            content: `**Cargo selecionado:** ${role.name}\n**Selecione o usuário para avaliar:**`,
            components: [userRow],
            ephemeral: true
        });
    }
    
    // Handler para seleção de usuários
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_user') {
        const selectedUserId = interaction.values[0];
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(selectedUserId);
        
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
        
        // Criar menu de seleção de nota
        const scoreOptions = [];
        for (let i = 0; i <= 10; i++) {
            scoreOptions.push({
                label: `${i}/10`,
                value: i.toString(),
                description: i <= 3 ? '⚠️ Nota baixa' : i <= 6 ? '📊 Nota média' : '🌟 Nota alta'
            });
        }
        
        const scoreSelectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_score_${selectedUserId}`)
            .setPlaceholder('Selecione uma nota de 0 a 10')
            .addOptions(scoreOptions);
        
        const scoreRow = new ActionRowBuilder().addComponents(scoreSelectMenu);
        
        await interaction.update({
            content: `**Avaliando:** ${targetMember.user.tag}\n**Selecione a nota:**`,
            components: [scoreRow],
            ephemeral: true
        });
    }
    
    // Handler para seleção de nota
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_score_')) {
        const selectedUserId = interaction.customId.replace('select_score_', '');
        const score = parseInt(interaction.values[0]);
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(selectedUserId);
        
        if (!targetMember) {
            return interaction.update({
                content: '❌ Usuário não encontrado!',
                components: [],
                ephemeral: true
            });
        }
        
        // Armazenar temporariamente a nota
        const tempData = new Map();
        tempData.set(`review_${interaction.user.id}`, {
            targetId: selectedUserId,
            targetName: targetMember.user.tag,
            score: score
        });
        
        // Criar modal para feedback
        const modal = {
            title: 'Feedback da Avaliação',
            customId: `feedback_modal_${interaction.user.id}`,
            components: [
                {
                    type: 1,
                    components: [{
                        type: 4,
                        style: 2,
                        label: 'O que você achou? O que podia melhorar?',
                        customId: 'feedback',
                        placeholder: 'Digite seu feedback aqui (máx. 700 caracteres)',
                        required: true,
                        min_length: 0,
                        max_length: 700
                    }]
                }
            ]
        };
        
        await interaction.showModal(modal);
        
        // Armazenar dados temporários
        global.tempReviewData = global.tempReviewData || new Map();
        global.tempReviewData.set(interaction.user.id, {
            targetId: selectedUserId,
            targetName: targetMember.user.tag,
            score: score
        });
    }
    
    // Handler para modal de feedback
    if (interaction.isModalSubmit() && interaction.customId.startsWith('feedback_modal_')) {
        const userId = interaction.customId.replace('feedback_modal_', '');
        const feedback = interaction.fields.getTextInputValue('feedback');
        const tempData = global.tempReviewData?.get(interaction.user.id);
        
        if (!tempData) {
            return interaction.reply({
                content: '❌ Sessão expirada! Por favor, inicie uma nova avaliação.',
                ephemeral: true
            });
        }
        
        const { targetId, targetName, score } = tempData;
        const guild = interaction.guild;
        const reviewer = interaction.user;
        const reviewed = await guild.members.fetch(targetId);
        
        // Salvar avaliação no banco
        const review = new Review({
            reviewerId: reviewer.id,
            reviewedId: reviewed.id,
            reviewerName: reviewer.tag,
            reviewedName: reviewed.user.tag,
            score: score,
            feedback: feedback
        });
        
        await review.save();
        
        // Criar embed para o log
        const embed = await createReviewEmbed(reviewer, reviewed.user, score, feedback);
        
        // Enviar para o canal de logs
        const logChannel = client.channels.cache.get(REVIEWS_LOG_CHANNEL_ID);
        if (logChannel) {
            await logChannel.send({ embeds: [embed] });
        }
        
        // Limpar dados temporários
        global.tempReviewData.delete(interaction.user.id);
        
        await interaction.reply({
            content: '✅ Avaliação enviada com sucesso! Obrigado por contribuir com o sistema de avaliação da equipe.',
            ephemeral: true
        });
    }
});

// Sistema de logs e monitoramento
class Logger {
    static async logAction(action, details) {
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (!logChannel) return;
        
        const embed = new EmbedBuilder()
            .setTitle(`📋 ${action}`)
            .setColor(0x00AE86)
            .setTimestamp()
            .addFields(
                Object.entries(details).map(([key, value]) => ({
                    name: key,
                    value: String(value),
                    inline: true
                }))
            );
        
        await logChannel.send({ embeds: [embed] });
    }
}

// Sistema de backup automático
async function createBackup() {
    const reviews = await Review.find({});
    const weeklyRankings = await WeeklyRanking.find({});
    
    const backup = {
        timestamp: new Date(),
        reviews: reviews,
        weeklyRankings: weeklyRankings
    };
    
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir);
    }
    
    const filename = `backup_${Date.now()}.json`;
    fs.writeFileSync(path.join(backupDir, filename), JSON.stringify(backup, null, 2));
    
    Logger.logAction('Backup Automático', {
        'Arquivo': filename,
        'Avaliações': reviews.length,
        'Rankings': weeklyRankings.length
    });
}

// Backup semanal
cron.schedule('0 0 * * 1', async () => {
    await createBackup();
});

// Sistema de anti-crash
process.on('unhandledRejection', (error) => {
    console.error('❌ Erro não tratado:', error);
    Logger.logAction('Erro no Sistema', {
        'Erro': error.message,
        'Stack': error.stack?.substring(0, 500)
    });
});

// Sistema de status personalizado
function updateStatus() {
    const statuses = [
        { name: `${STAFF_ROLE_IDS.length} cargos da staff`, type: 3 },
        { name: '/clearall | /clear', type: 2 },
        { name: 'Sistema de Avaliação', type: 3 },
        { name: `${client.guilds.cache.size} servidores`, type: 3 }
    ];
    
    let index = 0;
    setInterval(() => {
        const status = statuses[index % statuses.length];
        client.user.setPresence({
            activities: [{ name: status.name, type: status.type }],
            status: 'online'
        });
        index++;
    }, 10000);
}

// Comandos administrativos adicionais
class AdminCommands {
    static async getStats(interaction) {
        const totalReviews = await Review.countDocuments();
        const weeklyRankings = await WeeklyRanking.countDocuments();
        const averageScore = await Review.aggregate([
            { $group: { _id: null, avg: { $avg: '$score' } } }
        ]);
        
        const embed = new EmbedBuilder()
            .setTitle('📊 Estatísticas do Bot')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Total de Avaliações', value: totalReviews.toString(), inline: true },
                { name: 'Rankings Semanais', value: weeklyRankings.toString(), inline: true },
                { name: 'Média Geral', value: averageScore[0]?.avg.toFixed(2) || '0', inline: true },
                { name: 'Cargos Staff', value: STAFF_ROLE_IDS.length.toString(), inline: true },
                { name: 'Uptime', value: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`, inline: true }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    static async exportReviews(interaction) {
        const reviews = await Review.find({}).limit(1000);
        const data = reviews.map(r => ({
            avaliador: r.reviewerName,
            avaliado: r.reviewedName,
            nota: r.score,
            feedback: r.feedback,
            data: r.createdAt
        }));
        
        const jsonData = JSON.stringify(data, null, 2);
        const buffer = Buffer.from(jsonData, 'utf-8');
        
        await interaction.reply({
            content: '📁 Exportação de avaliações concluída!',
            files: [{ attachment: buffer, name: `reviews_${Date.now()}.json` }],
            ephemeral: true
        });
    }
}

// Inicialização do bot
client.login(TOKEN).then(() => {
    console.log('🚀 Bot iniciado com sucesso!');
    updateStatus();
    
    // Limpeza periódica de dados antigos
    setInterval(async () => {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        
        const result = await Review.deleteMany({
            createdAt: { $lt: sixMonthsAgo }
        });
        
        if (result.deletedCount > 0) {
            Logger.logAction('Limpeza Automática', {
                'Avaliações Removidas': result.deletedCount,
                'Período': 'Mais de 6 meses'
            });
        }
    }, 7 * 24 * 60 * 60 * 1000); // Uma vez por semana
});

// Exportar módulos para uso em outros arquivos
module.exports = {
    client,
    Review,
    WeeklyRanking,
    Logger,
    AdminCommands
};
// File: enhanced-qa-agent.js

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { PROMPTS } from './prompts.js';

// Optional dependency dengan graceful fallback
let showdown;
try {
  showdown = await import('showdown');
} catch (e) {
  console.log("💡 Tip: Install 'showdown' for enhanced HTML export: npm install showdown");
}

dotenv.config();

// =====================
// SESSION MANAGEMENT
// =====================
class SessionManager {
  constructor() {
    this.sessionsDir = './sessions';
    this.currentSession = null;
    this.ensureSessionsDir();
  }

  ensureSessionsDir() {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  createSession(name = null) {
    const sessionId = crypto.randomBytes(8).toString('hex');
    const timestamp = new Date().toISOString();
    const sessionName = name || `session_${timestamp.split('T')[0]}`;
    
    this.currentSession = {
      id: sessionId,
      name: sessionName,
      created: timestamp,
      conversations: [],
      totalRequests: 0,
      models: []
    };

    this.saveSession();
    return this.currentSession;
  }

  saveSession() {
    if (!this.currentSession) return;
    
    const filePath = path.join(this.sessionsDir, `${this.currentSession.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2));
  }

  loadSession(sessionId) {
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      this.currentSession = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return this.currentSession;
    }
    return null;
  }

  listSessions() {
    const files = fs.readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const filePath = path.join(this.sessionsDir, f);
      const session = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        id: session.id,
        name: session.name,
        created: session.created,
        conversations: session.conversations?.length || 0
      };
    });
  }

  addConversation(input, output, model, task, metadata = {}) {
    if (!this.currentSession) return;

    this.currentSession.conversations.push({
      timestamp: new Date().toISOString(),
      input: input.substring(0, 500) + (input.length > 500 ? '...' : ''),
      output: output.substring(0, 1000) + (output.length > 1000 ? '...' : ''),
      model,
      task,
      metadata
    });

    this.currentSession.totalRequests++;
    if (!this.currentSession.models.includes(model)) {
      this.currentSession.models.push(model);
    }

    this.saveSession();
  }

  getRecentContext(limit = 2) {
    if (!this.currentSession || !this.currentSession.conversations.length) return '';

    const recent = this.currentSession.conversations.slice(-limit);
    return recent.map(conv => 
      `Previous ${conv.task}: ${conv.input.substring(0, 100)}...`
    ).join('\n');
  }
}

// =====================
// MODEL CONFIGURATIONS
// =====================
const MODELS = {
  openai: {
    name: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    key: process.env.OPENAI_API_KEY,
    headers: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    }),
    format: (input, submodel = 'gpt-3.5-turbo') => ({
      model: submodel,
      messages: [{ role: 'user', content: input }],
      temperature: 0.7
    }),
    extract: (res) => res.choices[0].message.content,
    models: [
      { id: 'gpt-3.5-turbo', desc: 'GPT-3.5 Turbo - Economic Choice 💰', cost: 'Low' },
      { id: 'gpt-4o-mini', desc: 'GPT-4o Mini - Small & Efficient 💰', cost: 'Low' },
      { id: 'gpt-4-turbo', desc: 'GPT-4 Turbo - Balanced Performance 💸', cost: 'Medium' },
      { id: 'gpt-4o', desc: 'GPT-4o - Most Capable 💸', cost: 'High' }
    ]
  },
  ollama: {
    name: 'Ollama (Local)',
    url: 'http://localhost:11434/api/generate',
    headers: () => ({ 'Content-Type': 'application/json' }),
    format: (input, submodel = 'gemma2:2b') => ({ 
      model: submodel, 
      prompt: input,
      options: { temperature: 0.7 }
    }),
    extract: (res) => res.response,
    models: [] // Will be populated dynamically
  },
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    key: process.env.OPENROUTER_API_KEY,
    headers: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Enhanced QA AI Agent CLI'
    }),
    format: (input, submodel = 'google/gemini-2.0-flash-001') => ({
      model: submodel,
      messages: [{ role: 'user', content: input }],
      temperature: 0.7
    }),
    extract: (res) => res.choices[0].message.content,
    models: [
      { id: 'google/gemini-2.0-flash-001', desc: 'Gemini 2.0 Flash - Latest & Economic 💰', cost: 'Low' },
      { id: 'google/gemini-pro', desc: 'Gemini Pro - Reliable & Affordable 💰', cost: 'Low' },
      { id: 'google/gemini-1.5-flash', desc: 'Gemini 1.5 Flash - Fast & Cheap 💰', cost: 'Low' },
      { id: 'openai/gpt-3.5-turbo', desc: 'GPT-3.5 Turbo - Fast & Economic 💰', cost: 'Low' },
      { id: 'meta-llama/llama-3-8b-instruct', desc: 'Llama 3 8B - Open Source Budget 💰', cost: 'Low' },
      { id: 'mistralai/mistral-7b-instruct', desc: 'Mistral 7B - European Budget Model 💰', cost: 'Low' },
      { id: 'openai/gpt-4o-mini', desc: 'GPT-4o Mini - Small but Powerful 💰', cost: 'Medium' },
      { id: 'openai/gpt-4o', desc: 'GPT-4o - Premium Quality 💸', cost: 'High' },
      { id: 'meta-llama/llama-3-70b-instruct', desc: 'Llama 3 70B - Open Source Power 💸', cost: 'High' },
      { id: 'custom', desc: 'Custom Model - Enter your own model ID 🎯', cost: 'Variable' }
    ]
  }
};

// =====================
// EXPORT FORMATS
// =====================
const EXPORT_FORMATS = {
  txt: { 
    extension: '.txt', 
    name: 'Plain Text', 
    icon: '📄',
    converter: (content) => content 
  },
  md: { 
    extension: '.md', 
    name: 'Markdown', 
    icon: '📝',
    converter: (content) => content 
  },
  json: { 
    extension: '.json', 
    name: 'JSON', 
    icon: '📊',
    converter: (content) => JSON.stringify({ 
      result: content, 
      timestamp: new Date().toISOString(),
      format: 'qa_ai_agent_output',
      version: '3.0'
    }, null, 2) 
  },
  html: { 
    extension: '.html', 
    name: 'HTML', 
    icon: '🌐',
    converter: (content) => {
      if (showdown) {
        const converter = new showdown.Converter({
          tables: true,
          strikethrough: true,
          tasklists: true,
          ghCodeBlocks: true,
          ghMentions: true,
          headerLevelStart: 2
        });
        const htmlContent = converter.makeHtml(content);
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QA AI Agent Output</title>
    <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
          max-width: 900px; 
          margin: 0 auto; 
          padding: 20px; 
          line-height: 1.6; 
          color: #333;
        }
        pre { 
          background: #f8f9fa; 
          padding: 15px; 
          border-radius: 8px; 
          overflow-x: auto; 
          border-left: 4px solid #007acc;
        }
        code { 
          background: #f1f3f4; 
          padding: 2px 6px; 
          border-radius: 4px; 
          font-family: 'Monaco', 'Menlo', monospace;
        }
        blockquote { 
          border-left: 4px solid #e1e4e8; 
          margin: 0; 
          padding-left: 20px; 
          color: #6a737d; 
          font-style: italic;
        }
        table { 
          border-collapse: collapse; 
          width: 100%; 
          margin: 15px 0;
        }
        th, td { 
          border: 1px solid #e1e4e8; 
          padding: 12px; 
          text-align: left; 
        }
        th { 
          background-color: #f6f8fa; 
          font-weight: 600;
        }
        .header { 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .timestamp { 
          color: #6a737d; 
          font-size: 0.9em; 
          margin-top: 30px; 
          padding-top: 20px;
          border-top: 1px solid #e1e4e8;
        }
        h1, h2, h3 { color: #24292e; }
        h1 { border-bottom: 2px solid #e1e4e8; padding-bottom: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🤖 QA AI Agent Output</h1>
        <p>Generated with Enhanced QA AI Agent CLI v3.0</p>
    </div>
    ${htmlContent}
    <div class="timestamp">
        <strong>Generated:</strong> ${new Date().toLocaleString()}<br>
        <strong>Tool:</strong> Enhanced QA AI Agent CLI v3.0
    </div>
</body>
</html>`;
      } else {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QA AI Agent Output</title>
    <style>
        body { 
          font-family: 'Monaco', 'Menlo', monospace; 
          max-width: 900px; 
          margin: 0 auto; 
          padding: 20px; 
          white-space: pre-wrap; 
          background: #f8f9fa;
          color: #24292e;
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .timestamp { 
          color: #6a737d; 
          font-size: 0.9em; 
          margin-top: 20px; 
          padding-top: 20px;
          border-top: 1px solid #e1e4e8;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 QA AI Agent Output</h1>
        ${content.replace(/</g, '<').replace(/>/g, '>')}
        <div class="timestamp">
            <strong>Generated:</strong> ${new Date().toLocaleString()}<br>
            <strong>Tool:</strong> Enhanced QA AI Agent CLI v3.0
        </div>
    </div>
</body>
</html>`;
      }
    }
  }
};

// =====================
// MULTI-AGENT SYSTEM
// =====================
class MultiAgentOrchestrator {
  constructor(models) {
    this.models = models;
  }

  async runCollaboration(input, mode, selectedModels, taskName) {
    console.log(`\n🤖 Multi-Agent ${mode} Mode`);
    console.log('='.repeat(60));

    switch (mode) {
      case 'Debate':
        return await this.runDebateMode(input, selectedModels);
      case 'Pipeline':
        return await this.runPipelineMode(input, selectedModels);
      case 'Consensus':
        return await this.runConsensusMode(input, selectedModels);
      default:
        return await this.callSingleAgent(selectedModels[0], input);
    }
  }

  async runDebateMode(input, agents, rounds = 2) {
    const responses = [];
    
    for (let round = 1; round <= rounds; round++) {
      console.log(`\n🗣️  Round ${round} of ${rounds}`);
      
      for (const agent of agents) {
        console.log(`\n🤖 Agent ${agent.provider}-${agent.model} thinking...`);
        
        let context = '';
        if (responses.length > 0) {
          const recentResponses = responses.slice(-2);
          context = `\n\nPrevious perspectives:\n${recentResponses.map(r => 
            `${r.agent}: ${r.response.substring(0, 200)}...`
          ).join('\n')}\n\nNow provide your perspective, considering the above:`;
        }

        const fullInput = input + context;
        const result = await this.callSingleAgent(agent, fullInput);
        
        if (result.success) {
          responses.push({
            round,
            agent: `${agent.provider}-${agent.model}`,
            response: result.result
          });
          
          console.log(`✅ Response received (${result.result.length} chars)`);
        } else {
          console.log(`❌ Failed: ${result.error}`);
        }
      }
    }

    return this.synthesizeDebateResults(responses);
  }

  async runPipelineMode(input, agents) {
    let currentInput = input;
    const results = [];

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      console.log(`\n📡 Pipeline Step ${i + 1}/${agents.length}: ${agent.provider}-${agent.model}`);
      
      const pipelinePrompt = i === 0 ? 
        currentInput : 
        `Build upon and refine this previous analysis:\n\n${currentInput}\n\nProvide additional insights, corrections, or enhancements:`;

      const result = await this.callSingleAgent(agent, pipelinePrompt);
      
      if (result.success) {
        results.push({
          step: i + 1,
          agent: `${agent.provider}-${agent.model}`,
          input: currentInput.substring(0, 100) + '...',
          output: result.result
        });
        
        currentInput = result.result;
        console.log(`✅ Step ${i + 1} completed`);
      } else {
        console.log(`❌ Step ${i + 1} failed: ${result.error}`);
        break;
      }
    }

    return this.synthesizePipelineResults(results);
  }

  async runConsensusMode(input, agents) {
    const responses = [];

    console.log('\n📊 Collecting individual responses...');
    for (const agent of agents) {
      console.log(`\n🤖 Consulting ${agent.provider}-${agent.model}...`);
      
      const result = await this.callSingleAgent(agent, input);
      if (result.success) {
        responses.push({
          agent: `${agent.provider}-${agent.model}`,
          response: result.result,
          confidence: this.estimateConfidence(result.result)
        });
        console.log(`✅ Response collected (confidence: ${responses[responses.length - 1].confidence}%)`);
      } else {
        console.log(`❌ Failed: ${result.error}`);
      }
    }

    return this.buildConsensus(responses, input);
  }

  async callSingleAgent(agent, input) {
    const model = this.models[agent.provider];
    if (!model) return { success: false, error: 'Provider not found' };

    try {
      const body = JSON.stringify(model.format(input, agent.model));
      const res = await fetch(model.url, {
        method: 'POST',
        headers: model.headers(model.key),
        body
      });

      const rawText = await res.text();
      
      if (agent.provider === 'ollama') {
        const lines = rawText.split(/\r?\n/).filter(Boolean);
        let combined = '';
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.response) combined += obj.response;
          } catch {}
        }
        return { success: true, result: combined.trim() };
      } else {
        const json = JSON.parse(rawText);
        return { success: true, result: model.extract(json) };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  synthesizeDebateResults(responses) {
    let synthesis = '\n🎯 MULTI-AGENT DEBATE SYNTHESIS\n' + '='.repeat(60) + '\n';
    
    const agentSummary = responses.reduce((acc, r) => {
      if (!acc[r.agent]) acc[r.agent] = [];
      acc[r.agent].push(r.response);
      return acc;
    }, {});

    Object.entries(agentSummary).forEach(([agent, responses]) => {
      synthesis += `\n🤖 **${agent.toUpperCase()} PERSPECTIVE:**\n`;
      synthesis += `${responses[responses.length - 1].substring(0, 400)}...\n`;
      synthesis += `\n📈 Evolution: ${responses.length} iterations\n`;
    });

    synthesis += '\n💡 **DEBATE INSIGHTS:**\n';
    synthesis += '• Multiple AI perspectives analyzed\n';
    synthesis += '• Iterative refinement through discussion\n';
    synthesis += '• Cross-model validation achieved\n';
    synthesis += `• Total responses: ${responses.length}\n`;

    return synthesis;
  }

  synthesizePipelineResults(results) {
    let synthesis = '\n🔗 MULTI-AGENT PIPELINE SYNTHESIS\n' + '='.repeat(60) + '\n';
    
    synthesis += `📊 **Pipeline executed with ${results.length} agents**\n\n`;
    
    results.forEach((result, index) => {
      synthesis += `**Step ${result.step}: ${result.agent}**\n`;
      if (index === 0) {
        synthesis += `Input: ${result.input}\n`;
      }
      synthesis += `Output: ${result.output.substring(0, 300)}...\n\n`;
    });

    synthesis += '📈 **FINAL REFINED OUTPUT:**\n';
    synthesis += '='.repeat(40) + '\n';
    synthesis += results[results.length - 1].output;

    return synthesis;
  }

  buildConsensus(responses, originalInput) {
    let consensus = '\n🤝 MULTI-AGENT CONSENSUS ANALYSIS\n' + '='.repeat(60) + '\n';
    
    consensus += `📋 **Original Query:** ${originalInput.substring(0, 200)}...\n\n`;
    consensus += `👥 **${responses.length} AI Agents Consulted**\n\n`;
    
    responses.forEach(r => {
      consensus += `🤖 **${r.agent.toUpperCase()}** (Confidence: ${r.confidence}%)\n`;
      consensus += `${r.response.substring(0, 300)}...\n\n`;
    });

    const highConfidenceResponses = responses.filter(r => r.confidence > 75);
    if (highConfidenceResponses.length > 0) {
      consensus += '✅ **HIGH CONFIDENCE CONSENSUS:**\n';
      consensus += '='.repeat(40) + '\n';
      consensus += highConfidenceResponses[0].response;
    } else {
      consensus += '⚖️ **BALANCED MULTI-PERSPECTIVE VIEW:**\n';
      consensus += '='.repeat(40) + '\n';
      consensus += responses.map(r => `**${r.agent}:** ${r.response}`).join('\n\n---\n\n');
    }

    return consensus;
  }

  estimateConfidence(response) {
    let confidence = 50;
    
    // Positive confidence indicators
    if (response.includes('definitely') || response.includes('clearly')) confidence += 15;
    if (response.includes('evidence') || response.includes('data')) confidence += 10;
    if (response.includes('research') || response.includes('studies')) confidence += 10;
    if (response.length > 800) confidence += 10; // Detailed responses
    
    // Negative confidence indicators
    if (response.includes('might') || response.includes('possibly')) confidence -= 10;
    if (response.includes('uncertain') || response.includes('not sure')) confidence -= 15;
    if (response.includes('I think') || response.includes('probably')) confidence -= 5;
    
    return Math.max(25, Math.min(95, confidence));
  }
}

// =====================
// UTILITY FUNCTIONS
// =====================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function ask(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function selectFromList(items, prompt, defaultIndex = 0, showIcons = false) {
  console.log(`\n${prompt}`);
  items.forEach((item, index) => {
    const icon = showIcons && item.icon ? `${item.icon} ` : '';
    const display = typeof item === 'string' ? item : item.desc || item.name || item;
    console.log(`${index + 1}. ${icon}${display}`);
  });
  
  const choice = await ask(`\nEnter number (1-${items.length}, default: ${defaultIndex + 1}): `);
  const selectedIndex = parseInt(choice.trim()) - 1;
  
  if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= items.length) {
    return defaultIndex;
  }
  return selectedIndex;
}

function displayResult(result, taskName, model = '') {
  console.log('\n' + '='.repeat(70));
  console.log(`📋 RESULT: ${taskName.toUpperCase()}`);
  if (model) console.log(`🤖 Model: ${model}`);
  console.log('='.repeat(70));
  console.log(result);
  console.log('='.repeat(70) + '\n');
}

async function exportResult(result, taskName, model = '') {
  const outputActions = [
    '👀 Display in Terminal',
    '💾 Export to File',
    '📺 Both Display & Export'
  ];
  
  const actionIndex = await selectFromList(outputActions, "Choose output action:", 0);
  const action = outputActions[actionIndex];
  
  if (action.includes('Display')) {
    displayResult(result, taskName, model);
  }
  
  if (action.includes('Export')) {
    const formatEntries = Object.entries(EXPORT_FORMATS);
    const formatItems = formatEntries.map(([key, value]) => ({
      key,
      desc: `${value.icon} ${value.name} (${value.extension})`,
      ...value
    }));
    
    const formatIndex = await selectFromList(formatItems, "Choose export format:", 0, true);
    const selectedFormat = formatItems[formatIndex];
    
    let exportPath = './output';
    const useCustomPath = await ask("\nUse custom export path? (y/n, default: n): ");
    
    if (useCustomPath.trim().toLowerCase() === 'y') {
      exportPath = await ask("Enter export directory path: ");
      try {
        fs.mkdirSync(exportPath, { recursive: true });
      } catch (error) {
        console.log(`⚠️  Could not create directory: ${error.message}`);
        exportPath = './output';
      }
    } else {
      if (!fs.existsSync(exportPath)) {
        fs.mkdirSync(exportPath, { recursive: true });
      }
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
    const cleanTaskName = taskName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    const fileName = `${cleanTaskName}_${timestamp}${selectedFormat.extension}`;
    const fullPath = path.join(exportPath, fileName);
    
    try {
      const convertedContent = selectedFormat.converter(result);
      fs.writeFileSync(fullPath, convertedContent, 'utf8');
      
      const stats = fs.statSync(fullPath);
      console.log(`\n✅ File exported successfully!`);
      console.log(`📁 Location: ${fullPath}`);
      console.log(`${selectedFormat.icon} Format: ${selectedFormat.name}`);
      console.log(`📏 Size: ${(stats.size / 1024).toFixed(2)} KB\n`);
      
      //New openfile functionality
      const openFile = await ask("Open the file? (y/n, default: n): ");
      if (openFile.trim().toLowerCase() === 'y') {
        try {
          const platform = process.platform;
          let cmd;

          if (platform === 'darwin') cmd = 'open';
          else if (platform === 'win32') cmd = 'start';
          else cmd = 'xdg-open';

          spawn(cmd, [fullPath], {
            shell: true,
            detached: true,
            stdio: 'ignore'
          });

          console.log(`🚀 Opening file with default application...\n`);
        } catch (error) {
          console.log(`⚠️  Could not open file: ${error.message}\n`);
        }
      }
      
    } catch (error) {
      console.log(`❌ Export failed: ${error.message}\n`);
      return false;
    }
  }
  
  return true;
}

async function runAgent(modelConfig, task, inputText, submodel) {
  const model = MODELS[modelConfig];
  if (!model) throw new Error(`Model ${modelConfig} not supported.`);

  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerIndex = 0;
  process.stdout.write('🤖 Processing');
  const spinner = setInterval(() => {
    process.stdout.write(`\r🤖 Processing ${spinnerFrames[spinnerIndex++ % spinnerFrames.length]}`);
  }, 100);

  let result, errorMsg = null;
  try {
    const body = JSON.stringify(model.format(inputText, submodel));
    const res = await fetch(model.url, {
      method: 'POST',
      headers: model.headers(model.key),
      body
    });
    
    const rawText = await res.text();
    
    if (modelConfig === 'ollama') {
      try {
        const lines = rawText.split(/\r?\n/).filter(Boolean);
        let combined = '';
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.response) combined += obj.response;
          } catch {}
        }
        result = combined.trim();
        if (!result) errorMsg = 'Model returned empty response';
      } catch (e) {
        errorMsg = 'Failed to parse Ollama response';
      }
    } else {
      try {
        const json = JSON.parse(rawText);
        result = model.extract(json);
        if (!result) errorMsg = 'Model returned empty result';
      } catch (e) {
        errorMsg = 'Failed to parse model response: ' + e.message;
      }
    }
  } catch (e) {
    errorMsg = 'Request failed: ' + e.message;
  } finally {
    clearInterval(spinner);
    process.stdout.write('\r🤖 Processing ✅ Complete!\n');
  }

  if (errorMsg) {
    console.log(`\n❌ Error: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  return { success: true, result };
}

// =====================
// OLLAMA INTEGRATION
// =====================
async function loadOllamaModels() {
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    const data = await response.json();
    
    if (data.models && Array.isArray(data.models)) {
      MODELS.ollama.models = data.models.map(model => ({
        id: model.name,
        desc: `${model.name} - ${(model.size / 1024 / 1024 / 1024).toFixed(1)}GB 🏠`,
        cost: 'Free (Local)'
      }));
      return true;
    }
  } catch (error) {
    MODELS.ollama.models = [
      { id: 'llama3.2:latest', desc: 'Llama 3.2 Latest - Install via: ollama pull llama3.2 🏠', cost: 'Free' },
      { id: 'gemma2:2b', desc: 'Gemma 2 2B - Lightweight model 🏠', cost: 'Free' },
      { id: 'qwen2.5:latest', desc: 'Qwen 2.5 Latest - High performance 🏠', cost: 'Free' }
    ];
  }
  return false;
}

// =====================
// ENSURE OLLAMA RUNNING
// =====================
async function ensureOllamaRunning() {
  const isRunning = await fetch('http://localhost:11434/api/tags')
    .then(res => res.ok)
    .catch(() => false);

  if (isRunning) {
    console.log('✅ Ollama is already running');
    return;
  }

  console.log('🚀 Starting Ollama server...');
  const ollamaProcess = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    shell: true
  });

  await new Promise(resolve => setTimeout(resolve, 3000)); // wait 3s before checking

  const maxRetries = 5;
  let ready = false;

  for (let i = 0; i < maxRetries; i++) {
    ready = await fetch('http://localhost:11434/api/tags')
      .then(res => res.ok)
      .catch(() => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000)); // wait 1s each retry
  }

  if (ready) {
    console.log('✅ Ollama is now running');
  } else {
    console.log('❌ Failed to start Ollama automatically. Please run "ollama serve" manually.');
  }
}

// =====================
// MAIN APPLICATION
// =====================
async function main() {
  console.log('🚀 Enhanced QA AI Agent CLI v3.0');
  console.log('='.repeat(60));
  console.log('🎯 Multi-Model | 🤖 Multi-Agent | 📊 Session Management');
  console.log('='.repeat(60));

  // Initialize API keys before doing anything else
  await checkAndSetupApiKeys();

  await ensureOllamaRunning();

  // Initialize session manager
  const sessionManager = new SessionManager();
  
  // Load Ollama models
  console.log('🔍 Checking Ollama availability...');
  const ollamaAvailable = await loadOllamaModels();
  if (ollamaAvailable) {
    console.log(`✅ Ollama detected with ${MODELS.ollama.models.length} models`);
  } else {
    console.log('⚠️  Ollama not available or no models found');
  }

  while (true) {
    try {
      const mainMenu = [
        '🔥 Quick Query',
        '🤖 Multi-Agent Mode',
        '⚙️ Custom Task',
        '💾 Session Management',
        '⚡ Batch Processing',
        '❌ Exit'
      ];

      const choice = await selectFromList(mainMenu, "Main Menu - Choose an option:", 0, true);
      
      switch (choice) {
        case 0: // Quick Query
          await handleQuickQuery(sessionManager);
          break;
          
        case 1: // Multi-Agent Mode
          await handleMultiAgentMode(sessionManager);
          break;
          
        case 2: // Custom Task
          await handleCustomTask(sessionManager);
          break;
          
        case 3: // Session Management (sebelumnya case 4)
          await handleSessionManagement(sessionManager);
          break;
          
        case 4: // Batch Processing (sebelumnya case 5)
          await handleBatchProcessing(sessionManager);
          break;
          
        case 5: // Exit (sebelumnya case 6)
          console.log('\n👋 Thank you for using Anyany.js, QA AI Agent CLI!');
          process.exit(0);
          
        default:
          console.log('❌ Invalid option');
      }
      
    } catch (error) {
      console.log(`\n❌ Error: ${error.message}`);
      console.log('Press any key to continue...');
      await ask('');
    }
  }
}

// =====================
// QA DOCUMENT PROCESSING
// =====================

async function processQADocument(filePath, isUrl = false) {
  let content = '';
  
  if (isUrl) {
    try {
      const response = await fetch(filePath);
      content = await response.text();
    } catch (error) {
      throw new Error(`Failed to fetch from URL: ${error.message}`);
    }
  } else {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found');
    }

    const extension = path.extname(filePath).toLowerCase();
    
    try {
      switch (extension) {
        case '.txt':
        case '.md':
          content = fs.readFileSync(filePath, 'utf8');
          break;
          
        case '.docx':
          throw new Error('DOCX format support requires additional dependencies. Please convert to TXT/MD first.');
          // Future: Add mammoth.js integration for DOCX
          
        case '.json':
          const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          content = JSON.stringify(jsonData, null, 2);
          break;
          
        case '.csv':
          const csvData = fs.readFileSync(filePath, 'utf8');
          // Simple CSV to text conversion
          content = csvData.split('\\n')
            .map(line => line.split(',').join('\\t'))
            .join('\\n');
          break;
          
        case '.pdf':
          throw new Error('PDF format support requires additional dependencies. Please convert to TXT/MD first.');
          // Future: Add pdf-parse integration
          
        default:
          throw new Error('Unsupported file format. Please use TXT, MD, JSON, or CSV files.');
      }
    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }
  }
  
  return content;
}

// =====================
// HANDLER FUNCTIONS
// =====================
async function handleQuickQuery(sessionManager) {
  if (!sessionManager.currentSession) {
    sessionManager.createSession();
    console.log(`✅ Created new session: ${sessionManager.currentSession.name}`);
  }

  const input = await ask('\n💬 Enter your question: ');
  if (!input.trim()) return;

  const providers = Object.keys(MODELS).filter(key => {
    const model = MODELS[key];
    return model.key || key === 'ollama';
  });

  if (providers.length === 0) {
    console.log('❌ No API keys configured. Please set up your environment variables.');
    return;
  }

  const providerIndex = await selectFromList(providers, "Choose AI provider:", 0);
  const selectedProvider = providers[providerIndex];
  const model = MODELS[selectedProvider];

  let selectedModel;
  if (model.models.length > 1) {
    const modelIndex = await selectFromList(model.models, `Choose ${model.name} model:`, 0);
    selectedModel = model.models[modelIndex];
  } else {
    selectedModel = model.models[0];
  }

  console.log(`\n🎯 Using: ${model.name} - ${selectedModel.desc}`);
  
  const result = await runAgent(selectedProvider, 'Quick Query', input, selectedModel.id);
  
  if (result.success) {
    await exportResult(result.result, 'Quick Query', `${model.name} (${selectedModel.id})`);
    sessionManager.addConversation(input, result.result, selectedProvider, 'Quick Query', {
      model: selectedModel.id,
      cost: selectedModel.cost
    });
  } else {
    console.log(`❌ Query failed: ${result.error}`);
  }
}

async function handleMultiAgentMode(sessionManager) {
  if (!sessionManager.currentSession) {
    sessionManager.createSession();
  }

  const input = await ask('\n💬 Enter your question for multi-agent analysis: ');
  if (!input.trim()) return;

  const modes = ['Debate', 'Pipeline', 'Consensus'];
  const modeIndex = await selectFromList(modes, "Choose collaboration mode:", 0);
  const selectedMode = modes[modeIndex];

  const orchestrator = new MultiAgentOrchestrator(MODELS);
  
  // Select agents
  const availableAgents = [];
  Object.entries(MODELS).forEach(([provider, model]) => {
    if (model.key || provider === 'ollama') {
      model.models.slice(0, 2).forEach(subModel => {
        availableAgents.push({
          provider,
          model: subModel.id,
          desc: `${model.name} - ${subModel.desc}`
        });
      });
    }
  });

  console.log('\n🤖 Select 2-3 agents for collaboration:');
  const selectedAgents = [];
  
  for (let i = 0; i < Math.min(3, availableAgents.length); i++) {
    if (i > 0) {
      const addMore = await ask(`Add another agent? (y/n, default: ${i < 2 ? 'y' : 'n'}): `);
      if (addMore.trim().toLowerCase() !== 'y' && i >= 2) break;
      if (addMore.trim().toLowerCase() === 'n') break;
    }
    
    const agentIndex = await selectFromList(
      availableAgents.filter(a => !selectedAgents.some(sa => sa.provider === a.provider && sa.model === a.model)),
      `Choose agent ${i + 1}:`,
      0
    );
    
    const availableFiltered = availableAgents.filter(a => !selectedAgents.some(sa => sa.provider === a.provider && sa.model === a.model));
    selectedAgents.push(availableFiltered[agentIndex]);
  }

  console.log(`\n🚀 Starting ${selectedMode} mode with ${selectedAgents.length} agents...`);
  
  const result = await orchestrator.runCollaboration(input, selectedMode, selectedAgents, 'Multi-Agent Analysis');
  
  if (result) {
    await exportResult(result, `Multi-Agent ${selectedMode}`, selectedAgents.map(a => a.desc).join(', '));
    sessionManager.addConversation(input, result, 'multi-agent', `${selectedMode} Mode`, {
      agents: selectedAgents,
      mode: selectedMode
    });
  }
}

// /**** START OF MODIFIED SECTION ****/
async function handleCustomTask(sessionManager) {
  console.log('\n⚙️  Custom Task Builder');
  console.log('Create a specialized AI task with custom prompts and parameters.');

  // Define task options mapping user-friendly names to PROMPTS keys
  const taskOptions = {
    'QA Document Quality Check': 'QA_DOC_CHECKER',
    'Bug Analysis': 'BUG_ANALYSIS',
    'Test Data Generator': 'TEST_DATA_GENERATOR',
    'Scenario Priority Analysis': 'SCENARIO_PRIORITY_ANALYSIS',
    'API Contract Test': 'API_CONTRACT_TEST',
    'Custom Task (No Special Prompt)': 'CUSTOM_TASK'
  };
  const taskDisplayNames = Object.keys(taskOptions);
  
  const taskIndex = await selectFromList(taskDisplayNames, "Choose task type:", 0);
  const selectedTaskName = taskDisplayNames[taskIndex];
  const selectedTaskKey = taskOptions[selectedTaskName];
  
  let input;
  let customPrompt = '';

  // Special handling for QA Document Quality Check
  if (selectedTaskKey === 'QA_DOC_CHECKER') {
    console.log('\n� QA Document Input Options:');
    const inputOptions = [
      'Direct Text Input',
      'File Input (.txt, .md, .json, .csv)',
      'URL Input (GitHub raw, Google Docs public, Notion public)'
    ];
    
    const inputChoice = await selectFromList(inputOptions, "Choose input method:", 0);
    
    switch (inputChoice) {
      case 0: // Direct Text
        console.log('\n📝 Enter your QA document content. End input with an empty line:');
        const lines = [];
        while (true) {
          const line = await ask('');
          if (line.trim() === '' && lines.length > 0) break;
          lines.push(line);
          if (lines.length === 1 && line.trim() === '') {
            lines.pop();
          }
        }
        input = lines.join('\n');
        break;
        
      case 1: // File Input
        const filePath = await ask('\n📁 Enter the path to your QA document: ');
        try {
          input = await processQADocument(filePath);
        } catch (error) {
          console.log(`❌ Error: ${error.message}`);
          return;
        }
        break;
        
      case 2: // URL Input
        const url = await ask('\n🔗 Enter the URL to your QA document: ');
        try {
          input = await processQADocument(url, true);
        } catch (error) {
          console.log(`❌ Error: ${error.message}`);
          return;
        }
        break;
    }
    
    if (!input) {
      console.log("❌ No input provided. Returning to main menu.");
      return;
    }

  // Special handling for API Contract Test
  } else if (selectedTaskKey === 'API_CONTRACT_TEST') {
    console.log('\n📝 Enter example JSON payload (you can paste the full object). End input with an empty line:');
    const lines = [];
    while (true) {
      const line = await ask('');
      if (line.trim() === '' && lines.length > 0) break;
      lines.push(line);
      if (lines.length === 1 && line.trim() === '') {
        lines.pop();
      }
    }
    input = lines.join('\n');

    if (!input) {
      console.log("❌ No input provided. Returning to main menu.");
      return;
    }

    try {
      JSON.parse(input);
    } catch (e) {
      console.log('⚠️  Warning: Input does not appear to be valid JSON. The model may struggle.');
    }

  } else {
    // Original flow for other tasks
    if (selectedTaskKey !== 'CUSTOM_TASK') {
        customPrompt = await ask('\n📝 Enter custom instructions (optional): ');
    }
    input = await ask('💬 Enter your content/question: ');
  }

  if (!sessionManager.currentSession) {
    sessionManager.createSession();
  }

  // Model selection
  const providers = Object.keys(MODELS).filter(key => {
    const model = MODELS[key];
    return model.key || key === 'ollama';
  });

  const providerIndex = await selectFromList(providers, "Choose AI provider:", 0);
  const selectedProvider = providers[providerIndex];
  const model = MODELS[selectedProvider];

  let selectedModel;
  if (model.models.length > 1) {
    const modelIndex = await selectFromList(model.models, `Choose ${model.name} model:`, 0);
    selectedModel = model.models[modelIndex];
  } else {
    selectedModel = model.models[0];
  }

  // Construct the final prompt
  let finalPrompt;
  if (selectedTaskKey === 'CUSTOM_TASK') {
      finalPrompt = input;
  } else {
      finalPrompt = PROMPTS[selectedTaskKey] || '';
      if (customPrompt.trim()) {
        finalPrompt += `\n\nAdditional instructions: ${customPrompt}`;
      }
      finalPrompt += `\n\nContent to process:\n${input}`;
  }

  console.log(`\n🎯 Running custom "${selectedTaskName}" task...`);
  
  const result = await runAgent(selectedProvider, selectedTaskName, finalPrompt, selectedModel.id);
  
  if (result.success) {
    const cleanTaskName = selectedTaskName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    await exportResult(result.result, cleanTaskName, `${model.name} (${selectedModel.id})`);
    sessionManager.addConversation(input, result.result, selectedProvider, `Custom ${selectedTaskName}`, {
      model: selectedModel.id,
      customPrompt: customPrompt || null
    });
  } else {
    console.log(`❌ Task failed: ${result.error}`);
  }
}
// /**** END OF MODIFIED SECTION ****/


async function handleSessionManagement(sessionManager) {
  const sessionActions = [
    '📋 View Current Session',
    '📁 List All Sessions',
    '🔄 Load Session',
    '✨ New Session',
    '📊 Session Statistics',
    '🔑 Manage API Keys',
    '🗑️ Delete Session',
    '⬅️ Back to Main Menu'
  ];

  const actionIndex = await selectFromList(sessionActions, "Session Management:", 0, true);
  
  switch (actionIndex) {
    case 0: // View Current
      if (sessionManager.currentSession) {
        console.log('\n📊 Current Session Details:');
        console.log('='.repeat(40));
        const session = sessionManager.currentSession;
        console.log(`Name: ${session.name}`);
        console.log(`ID: ${session.id}`);
        console.log(`Created: ${new Date(session.created).toLocaleString()}`);
        console.log(`Conversations: ${session.conversations.length}`);
        console.log(`Models Used: ${session.models.join(', ') || 'None'}`);
        
        if (session.conversations.length > 0) {
          console.log('\n📝 Recent Conversations:');
          session.conversations.slice(-3).forEach((conv, index) => {
            console.log(`${index + 1}. ${conv.task} (${conv.model}) - ${conv.timestamp}`);
            console.log(`   Input: ${conv.input.substring(0, 100)}...`);
          });
        }
      } else {
        console.log('\n❌ No active session');
      }
      break;
      
    case 1: // List All
      const sessions = sessionManager.listSessions();
      if (sessions.length === 0) {
        console.log('\n📭 No sessions found');
      } else {
        console.log('\n📁 All Sessions:');
        console.log('='.repeat(60));
        sessions.forEach((session, index) => {
          console.log(`${index + 1}. ${session.name} (${session.id})`);
          console.log(`   Created: ${new Date(session.created).toLocaleString()}`);
          console.log(`   Conversations: ${session.conversations}`);
        });
      }
      break;
      
    case 2: // Load Session
      const loadSessions = sessionManager.listSessions();
      if (loadSessions.length === 0) {
        console.log('\n❌ No sessions to load');
        break;
      }
      
      const sessionIndex = await selectFromList(
        loadSessions.map(s => `${s.name} (${s.conversations} conversations)`),
        "Choose session to load:",
        0
      );
      
      const loadedSession = sessionManager.loadSession(loadSessions[sessionIndex].id);
      if (loadedSession) {
        console.log(`✅ Loaded session: ${loadedSession.name}`);
      } else {
        console.log('❌ Failed to load session');
      }
      break;
      
    case 3: // New Session
      const sessionName = await ask('\n📝 Enter session name (optional): ');
      const newSession = sessionManager.createSession(sessionName.trim() || null);
      console.log(`✅ Created new session: ${newSession.name}`);
      break;
      
    case 4: // Statistics
      if (sessionManager.currentSession) {
        const session = sessionManager.currentSession;
        console.log('\n📊 Session Statistics:');
        console.log('='.repeat(40));
        console.log(`Total Requests: ${session.totalRequests}`);
        console.log(`Unique Models: ${session.models.length}`);
        
        const taskStats = {};
        session.conversations.forEach(conv => {
          taskStats[conv.task] = (taskStats[conv.task] || 0) + 1;
        });
        
        console.log('\n📈 Task Breakdown:');
        Object.entries(taskStats).forEach(([task, count]) => {
          console.log(`  ${task}: ${count} times`);
        });
      } else {
        console.log('\n❌ No active session for statistics');
      }
      break;

    case 5: // Manage API Keys 
      await manageApiKeys();
      break;

    case 6: // Delete Session
      const deleteSessions = sessionManager.listSessions();
      if (deleteSessions.length === 0) {
        console.log('\n❌ No sessions to delete');
        break;
      }
      
      const deleteIndex = await selectFromList(
        deleteSessions.map(s => `${s.name} (${s.conversations} conversations)`),
        "Choose session to delete:",
        0
      );
      
      const confirmDelete = await ask(`\n⚠️  Really delete "${deleteSessions[deleteIndex].name}"? (yes/no): `);
      if (confirmDelete.toLowerCase() === 'yes') {
        try {
          const filePath = path.join(sessionManager.sessionsDir, `${deleteSessions[deleteIndex].id}.json`);
          fs.unlinkSync(filePath);
          console.log('✅ Session deleted successfully');
          
          if (sessionManager.currentSession?.id === deleteSessions[deleteIndex].id) {
            sessionManager.currentSession = null;
            console.log('ℹ️  Current session cleared');
          }
        } catch (error) {
          console.log(`❌ Delete failed: ${error.message}`);
        }
      }
      break;
      
    case 7: // Back
      return;
  }
  
  if (actionIndex !== 7) {
    await ask('\nPress Enter to continue...');
    await handleSessionManagement(sessionManager);
  }
}

async function handleBatchProcessing(sessionManager) {
  console.log('\n⚡ Batch Processing Mode');
  console.log('Process multiple queries efficiently');

  const batchModes = [
    '📁 File Input (JSON/TXT)',
    '📝 Manual Input (Multiple Queries)',
    '🔄 Repeat Query with Different Models',
    '⬅️ Back to Main Menu'
  ];

  const modeIndex = await selectFromList(batchModes, "Choose batch mode:", 0, true);
  
  switch (modeIndex) {
    case 0: // File Input
      const filePath = await ask('\n📁 Enter file path: ');
      try {
        if (!fs.existsSync(filePath)) {
          console.log('❌ File not found');
          return;
        }
        
        const fileContent = fs.readFileSync(filePath, 'utf8');
        let queries = [];
        
        if (filePath.endsWith('.json')) {
          const jsonData = JSON.parse(fileContent);
          queries = Array.isArray(jsonData) ? jsonData : [jsonData];
        } else {
          queries = fileContent.split('\n').filter(line => line.trim());
        }
        
        console.log(`📊 Found ${queries.length} queries to process`);
        await processBatchQueries(queries, sessionManager);
        
      } catch (error) {
        console.log(`❌ File processing error: ${error.message}`);
      }
      break;
      
    case 1: // Manual Input
      const manualQueries = [];
      console.log('\n📝 Enter queries (empty line to finish):');
      
      while (true) {
        const query = await ask(`Query ${manualQueries.length + 1}: `);
        if (!query.trim()) break;
        manualQueries.push(query);
      }
      
      if (manualQueries.length > 0) {
        await processBatchQueries(manualQueries, sessionManager);
      }
      break;
      
    case 2: // Repeat with Different Models
      const singleQuery = await ask('\n💬 Enter query to test across models: ');
      if (!singleQuery.trim()) return;
      
      const providers = Object.keys(MODELS).filter(key => {
        const model = MODELS[key];
        return model.key || key === 'ollama';
      });
      
      console.log(`\n🔄 Testing query across ${providers.length} providers...`);
      await processQueryAcrossModels(singleQuery, providers, sessionManager);
      break;
      
    case 3: // Back
      return;
  }
}

async function processBatchQueries(queries, sessionManager) {
  if (!sessionManager.currentSession) {
    sessionManager.createSession('Batch Processing Session');
  }

  // Select provider and model
  const providers = Object.keys(MODELS).filter(key => {
    const model = MODELS[key];
    return model.key || key === 'ollama';
  });

  const providerIndex = await selectFromList(providers, "Choose provider for batch:", 0);
  const selectedProvider = providers[providerIndex];
  const model = MODELS[selectedProvider];

  let selectedModel;
  if (model.models.length > 1) {
    const modelIndex = await selectFromList(model.models, `Choose ${model.name} model:`, 0);
    selectedModel = model.models[modelIndex];
  } else {
    selectedModel = model.models[0];
  }

  console.log(`\n🚀 Processing ${queries.length} queries with ${model.name}...`);
  const results = [];
  
  for (let i = 0; i < queries.length; i++) {
    const query = typeof queries[i] === 'object' ? queries[i].query || queries[i].text : queries[i];
    console.log(`\n📋 Processing ${i + 1}/${queries.length}: ${query.substring(0, 50)}...`);
    
    const result = await runAgent(selectedProvider, 'Batch Query', query, selectedModel.id);
    
    if (result.success) {
      results.push({
        query: query,
        result: result.result,
        success: true
      });
      sessionManager.addConversation(query, result.result, selectedProvider, 'Batch Processing');
      console.log('✅ Success');
    } else {
      results.push({
        query: query,
        error: result.error,
        success: false
      });
      console.log(`❌ Failed: ${result.error}`);
    }
  }

  // Export batch results
  const batchReport = generateBatchReport(results, selectedModel);
  await exportResult(batchReport, 'Batch Processing Results', `${model.name} (${selectedModel.id})`);
}

async function processQueryAcrossModels(query, providers, sessionManager) {
  if (!sessionManager.currentSession) {
    sessionManager.createSession('Model Comparison Session');
  }

  const results = [];
  
  for (const provider of providers) {
    const model = MODELS[provider];
    const selectedModel = model.models[0]; // Use first available model
    
    console.log(`\n🤖 Testing with ${model.name} (${selectedModel.id})...`);
    
    const result = await runAgent(provider, 'Model Comparison', query, selectedModel.id);
    
    if (result.success) {
      results.push({
        provider: provider,
        model: selectedModel.id,
        modelName: model.name,
        result: result.result,
        success: true,
        responseLength: result.result.length
      });
      sessionManager.addConversation(query, result.result, provider, 'Model Comparison');
      console.log(`✅ Success (${result.result.length} chars)`);
    } else {
      results.push({
        provider: provider,
        model: selectedModel.id,
        modelName: model.name,
        error: result.error,
        success: false
      });
      console.log(`❌ Failed: ${result.error}`);
    }
  }

  // Generate comparison report
  const comparisonReport = generateComparisonReport(query, results);
  await exportResult(comparisonReport, 'Model Comparison Results', 'Multi-Model Analysis');
}

function generateBatchReport(results, model) {
  let report = `# 📊 Batch Processing Report\n\n`;
  report += `**Model Used:** ${model.desc}\n`;
  report += `**Total Queries:** ${results.length}\n`;
  report += `**Successful:** ${results.filter(r => r.success).length}\n`;
  report += `**Failed:** ${results.filter(r => !r.success).length}\n`;
  report += `**Success Rate:** ${((results.filter(r => r.success).length / results.length) * 100).toFixed(1)}%\n\n`;

  report += `## 📋 Results\n\n`;
  
  results.forEach((result, index) => {
    report += `### Query ${index + 1}\n`;
    report += `**Input:** ${result.query}\n\n`;
    
    if (result.success) {
      report += `**Output:** ${result.result}\n\n`;
    } else {
      report += `**Error:** ${result.error}\n\n`;
    }
    
    report += `---\n\n`;
  });

  return report;
}

function generateComparisonReport(query, results) {
  let report = `# 🔍 Model Comparison Report\n\n`;
  report += `**Query:** ${query}\n\n`;
  report += `**Models Tested:** ${results.length}\n`;
  report += `**Successful Responses:** ${results.filter(r => r.success).length}\n\n`;

  report += `## 📊 Performance Overview\n\n`;
  
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length > 0) {
    report += `| Model | Provider | Response Length | Status |\n`;
    report += `|-------|----------|-----------------|--------|\n`;
    
    results.forEach(result => {
      const status = result.success ? '✅ Success' : '❌ Failed';
      const length = result.success ? result.responseLength : 'N/A';
      report += `| ${result.model} | ${result.modelName} | ${length} | ${status} |\n`;
    });
  }

  report += `\n## 📋 Detailed Responses\n\n`;
  
  results.forEach((result, index) => {
    report += `### ${result.modelName} (${result.model})\n\n`;
    
    if (result.success) {
      report += `**Response:**\n${result.result}\n\n`;
    } else {
      report += `**Error:** ${result.error}\n\n`;
    }
    
    report += `---\n\n`;
  });

  return report;
}
// =====================
// API KEY MANAGEMENT
// =====================
async function checkAndSetupApiKeys() {
  const envPath = '.env';
  let envChanged = false;
  
  // Check if .env file exists
  if (!fs.existsSync(envPath)) {
    console.log('📝 Creating .env file...');
    fs.writeFileSync(envPath, '', 'utf8');
  }

  // Read current .env content
  const currentEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const envLines = currentEnv.split('\n').filter(line => line.trim());
  const envVars = {};
  
  // Parse existing environment variables
  envLines.forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      envVars[key.trim()] = valueParts.join('=').trim();
    }
  });

  console.log('\n🔐 API Key Configuration');
  console.log('='.repeat(60));

  // Check OpenAI API Key
  if (!process.env.OPENAI_API_KEY && !envVars.OPENAI_API_KEY) {
    console.log('\n🤖 OpenAI Configuration:');
    console.log('Get your API key from: https://platform.openai.com/api-keys');
    const openaiKey = await ask('Enter OpenAI API key (or press Enter to skip): ');
    
    if (openaiKey.trim()) {
      envVars.OPENAI_API_KEY = openaiKey.trim();
      process.env.OPENAI_API_KEY = openaiKey.trim();
      MODELS.openai.key = openaiKey.trim();
      envChanged = true;
      console.log('✅ OpenAI API key configured');
    } else {
      console.log('⏭️  OpenAI skipped - models will be unavailable');
    }
  } else {
    MODELS.openai.key = process.env.OPENAI_API_KEY || envVars.OPENAI_API_KEY;
    console.log('✅ OpenAI API key found');
  }

  // Check OpenRouter API Key
  if (!process.env.OPENROUTER_API_KEY && !envVars.OPENROUTER_API_KEY) {
    console.log('\n🌐 OpenRouter Configuration:');
    console.log('Get your API key from: https://openrouter.ai/keys');
    const openrouterKey = await ask('Enter OpenRouter API key (or press Enter to skip): ');
    
    if (openrouterKey.trim()) {
      envVars.OPENROUTER_API_KEY = openrouterKey.trim();
      process.env.OPENROUTER_API_KEY = openrouterKey.trim();
      MODELS.openrouter.key = openrouterKey.trim();
      envChanged = true;
      console.log('✅ OpenRouter API key configured');
    } else {
      console.log('⏭️  OpenRouter skipped - models will be unavailable');
    }
  } else {
    MODELS.openrouter.key = process.env.OPENROUTER_API_KEY || envVars.OPENROUTER_API_KEY;
    console.log('✅ OpenRouter API key found');
  }

  // Save to .env file if changed
  if (envChanged) {
    const newEnvContent = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    fs.writeFileSync(envPath, newEnvContent, 'utf8');
    console.log('\n💾 API keys saved to .env file');
    console.log('🔒 Keep your .env file secure and never commit it to version control!');
  }

  // Check if any providers are available
  const availableProviders = Object.keys(MODELS).filter(key => {
    const model = MODELS[key];
    return model.key || key === 'ollama';
  });

  if (availableProviders.length === 0) {
    console.log('\n⚠️  No API providers configured.');
    console.log('💡 You can still use Ollama if it\'s installed locally.');
    
    const continueAnyway = await ask('\nContinue anyway? (y/n, default: y): ');
    if (continueAnyway.trim().toLowerCase() === 'n') {
      console.log('👋 Goodbye! Run the application again to configure API keys.');
      process.exit(0);
    }
  }

  console.log('='.repeat(60));
}
function createEnvTemplate() {
  const envTemplate = `# Enhanced QA AI Agent CLI - Environment Variables
# Get OpenAI API key from: https://platform.openai.com/api-keys
OPENAI_API_KEY=

# Get OpenRouter API key from: https://openrouter.ai/keys  
OPENROUTER_API_KEY=

# Optional: Custom settings
# OLLAMA_HOST=http://localhost:11434
`;
  
  if (!fs.existsSync('.env')) {
    fs.writeFileSync('.env', envTemplate, 'utf8');
    console.log('📝 Created .env template file');
  }
}
async function manageApiKeys() {
  console.log('\n🔑 API Key Management');
  console.log('='.repeat(40));
  
  const keyActions = [
    '👀 View Current Keys (masked)',
    '✏️  Update OpenAI Key',
    '✏️  Update OpenRouter Key', 
    '🗑️  Clear All Keys',
    '📝 Recreate .env Template',
    '⬅️  Back'
  ];
  
  const actionIndex = await selectFromList(keyActions, "Choose action:", 0, true);
  
  switch (actionIndex) {
    case 0: // View Keys
      console.log('\n🔍 Current API Key Status:');
      console.log(`OpenAI: ${process.env.OPENAI_API_KEY ? '✅ Set (' + process.env.OPENAI_API_KEY.substring(0, 8) + '...)' : '❌ Not set'}`);
      console.log(`OpenRouter: ${process.env.OPENROUTER_API_KEY ? '✅ Set (' + process.env.OPENROUTER_API_KEY.substring(0, 8) + '...)' : '❌ Not set'}`);
      break;
      
    case 1: // Update OpenAI
      await updateApiKey('OPENAI_API_KEY', 'OpenAI', 'https://platform.openai.com/api-keys');
      break;
      
    case 2: // Update OpenRouter  
      await updateApiKey('OPENROUTER_API_KEY', 'OpenRouter', 'https://openrouter.ai/keys');
      break;
      
    case 3: // Clear All
      const confirmClear = await ask('\n⚠️  Really clear all API keys? (yes/no): ');
      if (confirmClear.toLowerCase() === 'yes') {
        await clearApiKeys();
      }
      break;
      
    case 4: // Recreate template
      createEnvTemplate();
      break;
      
    case 5: // Back
      return;
  }
  
  if (actionIndex !== 5) {
    await ask('\nPress Enter to continue...');
    await manageApiKeys();
  }
}

async function updateApiKey(keyName, serviceName, url) {
  console.log(`\n✏️  Update ${serviceName} API Key`);
  console.log(`Get your key from: ${url}`);
  
  const newKey = await ask(`Enter new ${serviceName} API key: `);
  if (newKey.trim()) {
    await saveApiKeyToEnv(keyName, newKey.trim());
    process.env[keyName] = newKey.trim();
    
    // Update model configuration
    if (keyName === 'OPENAI_API_KEY') {
      MODELS.openai.key = newKey.trim();
    } else if (keyName === 'OPENROUTER_API_KEY') {
      MODELS.openrouter.key = newKey.trim();
    }
    
    console.log(`✅ ${serviceName} API key updated successfully`);
  } else {
    console.log('❌ No key provided');
  }
}

async function saveApiKeyToEnv(keyName, keyValue) {
  const envPath = '.env';
  let envContent = '';
  
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  
  const envLines = envContent.split('\n');
  let keyFound = false;
  
  // Update existing key or add new one
  for (let i = 0; i < envLines.length; i++) {
    if (envLines[i].startsWith(`${keyName}=`)) {
      envLines[i] = `${keyName}=${keyValue}`;
      keyFound = true;
      break;
    }
  }
  
  if (!keyFound) {
    envLines.push(`${keyName}=${keyValue}`);
  }
  
  fs.writeFileSync(envPath, envLines.join('\n'), 'utf8');
}

async function clearApiKeys() {
  const envPath = '.env';
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envLines = envContent.split('\n');
    
    const clearedLines = envLines.map(line => {
      if (line.startsWith('OPENAI_API_KEY=') || line.startsWith('OPENROUTER_API_KEY=')) {
        return line.split('=')[0] + '=';
      }
      return line;
    });
    
    fs.writeFileSync(envPath, clearedLines.join('\n'), 'utf8');
  }
  
  // Clear from environment
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  MODELS.openai.key = null;
  MODELS.openrouter.key = null;
  
  console.log('✅ All API keys cleared');
}
// =====================
// START APPLICATION
// =====================
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('\n💥 Fatal Error:', error.message);
    console.log('🔧 Troubleshooting tips:');
    console.log('  • Check your API keys in .env file');
    console.log('  • Ensure internet connection for cloud models');
    console.log('  • For Ollama: Run "ollama serve" if using local models');
    console.log('  • Check file permissions in current directory');
    process.exit(1);
  });
}

// =====================
// GRACEFUL SHUTDOWN
// =====================
process.on('SIGINT', () => {
  console.log('\n\n👋 Gracefully shutting down...');
  console.log('💾 Sessions saved automatically');
  console.log('✨ Thank you for using Anyany.js, QA AI Agent CLI!');
  rl.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n📱 Received termination signal...');
  rl.close();
  process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.log('\n⚠️  Unhandled Rejection at:', promise, 'reason:', reason);
  console.log('🔄 Continuing execution...');
});

// =====================
// EXPORTS FOR MODULE USE
// =====================
export {
  SessionManager,
  MultiAgentOrchestrator,
  MODELS,
  EXPORT_FORMATS,
  PROMPTS,
  runAgent,
  exportResult,
  selectFromList,
  displayResult
};

// =====================
// CLI HELP INFORMATION
// =====================
function showHelp() {
  console.log(`
🤖 Enhanced QA AI Agent CLI v3.0 - Help Guide
${'='.repeat(60)}

FEATURES:
- 🔥 Quick Query - Fast single questions
- 🤖 Multi-Agent Mode - Collaborative AI analysis
- ⚙️ Custom Tasks - Specialized prompts
- 💾 Session Management - Persistent conversations
- ⚡ Batch Processing - Multiple queries at once

SUPPORTED PROVIDERS:
- OpenAI (GPT models) - Requires OPENAI_API_KEY
- OpenRouter (Multiple models) - Requires OPENROUTER_API_KEY  
- Ollama (Local models) - Requires Ollama running locally

SETUP:
1. Create .env file with your API keys:
   OPENAI_API_KEY=your_openai_key
   OPENROUTER_API_KEY=your_openrouter_key

2. Install optional dependencies:
   npm install showdown

3. For local models:
   Install Ollama and pull models: ollama pull llama3.2

USAGE:
- Run: node enhanced-qa-agent.js
- Follow interactive prompts
- Sessions auto-save to ./sessions/
- Exports save to ./output/

TIPS:
- Multi-Agent mode provides diverse perspectives
- Batch processing saves time for multiple queries
- Sessions preserve context across runs

For issues, check API keys and network connectivity.
${'='.repeat(60)}
  `);
}

// Check for help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp();
  process.exit(0);
}

// =====================
// VERSION CHECK AND UPDATE NOTIFICATION
// =====================
async function checkForUpdates() {
  try {
    // This would typically check a remote version file
    // For now, we'll just show current version info
    console.log('ℹ️  Enhanced QA AI Agent CLI v3.0 - Latest Version');
    main();
  } catch (error) {
    // Silently fail if update check fails
  }
}

// Run update check in background (non-blocking)
checkForUpdates();
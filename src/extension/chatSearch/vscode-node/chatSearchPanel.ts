/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IChatDebugFileLoggerService, sessionResourceToId } from '../../../platform/chat/common/chatDebugFileLoggerService';
import { ISessionTranscriptService, TranscriptEntry } from '../../../platform/chat/common/sessionTranscriptService';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { URI } from '../../../util/vs/base/common/uri';
import { IChatSearchPanelService } from '../common/chatSearchPanelService';
import { IChatSearchOptions, IChatSearchResult, IChatSearchService } from '../common/chatSearchService';

interface IChatSearchMessage {
	readonly role: string;
	readonly content: string;
	readonly index: number;
}

interface IPanelState {
	readonly sessionResource?: string;
	readonly query: string;
	readonly options: IChatSearchOptions;
	readonly messages: IChatSearchMessage[];
	readonly results: IChatSearchResult[];
	readonly currentMatchIndex: number;
	readonly loading: boolean;
	readonly status: string;
}

export class ChatSearchPanel extends Disposable implements IChatSearchPanelService {
	declare readonly _serviceBrand: undefined;

	private _panel: vscode.WebviewPanel | undefined;
	private _sessionResource: vscode.Uri | undefined;
	private _messages: IChatSearchMessage[] = [];
	private _currentQuery = '';
	private _currentOptions: IChatSearchOptions = {};
	private _currentResults: IChatSearchResult[] = [];
	private _currentMatchIndex = -1;
	private _loading = false;
	private _status = 'Open a chat session and search the transcript.';

	constructor(
		@IChatSearchService private readonly chatSearchService: IChatSearchService,
		@ISessionTranscriptService private readonly sessionTranscriptService: ISessionTranscriptService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IChatDebugFileLoggerService private readonly chatDebugFileLoggerService: IChatDebugFileLoggerService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register(vscode.window.onDidChangeActiveChatPanelSessionResource(resource => {
			if (this._panel) {
				void this._refreshSession(resource);
			}
		}));
	}

	show(): void {
		if (!this._panel) {
			this._createPanel();
		}

		this._panel?.reveal(vscode.ViewColumn.Active, true);
		void this._refreshSession(vscode.window.activeChatPanelSessionResource);
	}

	hide(): void {
		this._panel?.dispose();
		this._panel = undefined;
		void vscode.commands.executeCommand('setContext', 'github.copilot.chat.search.visible', false);
	}

	nextMatch(): void {
		this.chatSearchService.goToNextMatch();
		this._currentMatchIndex = this.chatSearchService.getCurrentMatchIndex();
		this._postState();
	}

	previousMatch(): void {
		this.chatSearchService.goToPreviousMatch();
		this._currentMatchIndex = this.chatSearchService.getCurrentMatchIndex();
		this._postState();
	}

	closeSearch(): void {
		this.chatSearchService.clearSearch();
		this._currentQuery = '';
		this._currentOptions = {};
		this._currentResults = [];
		this._currentMatchIndex = -1;
		this._status = 'Search cleared.';
		this._postState();
		void vscode.commands.executeCommand('setContext', 'github.copilot.chat.search.visible', false);
	}

	private _createPanel(): void {
		this._panel = vscode.window.createWebviewPanel(
			'github.copilot.chat.search',
			'Chat Search',
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			},
		);

		this._register(this._panel.onDidDispose(() => {
			this._panel = undefined;
			this._messages = [];
			this._currentResults = [];
			this._currentQuery = '';
			this._currentMatchIndex = -1;
			void vscode.commands.executeCommand('setContext', 'github.copilot.chat.search.visible', false);
		}));

		this._register(this._panel.webview.onDidReceiveMessage(message => {
			void this._handleMessage(message);
		}));

		this._panel.webview.html = this._getHtml(this._panel.webview);
	}

	private async _handleMessage(message: unknown): Promise<void> {
		if (!message || typeof message !== 'object') {
			return;
		}

		const typed = message as { command?: string; query?: string; options?: IChatSearchOptions };
		switch (typed.command) {
			case 'ready':
				await this._refreshSession(vscode.window.activeChatPanelSessionResource);
				return;
			case 'queryChanged':
				this._currentQuery = typed.query ?? '';
				this._currentOptions = typed.options ?? {};
				this._currentResults = this.chatSearchService.search(this._currentQuery, this._currentOptions);
				this._currentMatchIndex = this.chatSearchService.getCurrentMatchIndex();
				this._status = this._currentResults.length > 0 ? `${this._currentResults.length} matches` : 'No matches';
				this._postState();
				return;
			case 'next':
				this.nextMatch();
				return;
			case 'previous':
				this.previousMatch();
				return;
			case 'close':
				this.closeSearch();
				return;
			default:
				return;
		}
	}

	private async _refreshSession(sessionResource: vscode.Uri | undefined): Promise<void> {
		this._sessionResource = sessionResource;
		this._loading = true;
		this._status = sessionResource ? 'Loading transcript...' : 'No active chat session.';
		this._postState();

		if (!sessionResource) {
			this._messages = [];
			this.chatSearchService.setMessages([]);
			this._loading = false;
			this._postState();
			return;
		}

		try {
			const sessionId = sessionResourceToId(sessionResource);
			const transcriptUri = this.sessionTranscriptService.getTranscriptPath(sessionId) ?? this.chatDebugFileLoggerService.getLogPath(sessionId);

			if (!transcriptUri) {
				this._messages = [];
				this._status = 'No transcript file is available for this session yet.';
				this.chatSearchService.setMessages([]);
				return;
			}

			const content = await this.fileSystemService.readFile(transcriptUri, true);
			this._messages = this._parseTranscript(transcriptUri, content);
			this.chatSearchService.setMessages(this._messages.map(message => `${message.role}: ${message.content}`));
			this._status = this._messages.length > 0 ? `Loaded ${this._messages.length} transcript entries.` : 'Transcript is empty.';
			if (this._currentQuery) {
				this._currentResults = this.chatSearchService.search(this._currentQuery, this._currentOptions);
				this._currentMatchIndex = this.chatSearchService.getCurrentMatchIndex();
			}
		} catch (error) {
			this._messages = [];
			this._status = `Failed to load transcript: ${String(error)}`;
			this.logService.error(`[ChatSearchPanel] ${String(error)}`);
			this.chatSearchService.setMessages([]);
		}

		this._loading = false;
		this._postState();
	}

	private _parseTranscript(transcriptUri: URI, content: Uint8Array): IChatSearchMessage[] {
		const text = Buffer.from(content).toString('utf8');
		const messages: IChatSearchMessage[] = [];
		const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);

		for (const [index, line] of lines.entries()) {
			try {
				const entry = JSON.parse(line) as TranscriptEntry;
				if (entry.type === 'user.message') {
					messages.push({ index, role: 'User', content: entry.data.content });
				} else if (entry.type === 'assistant.message') {
					messages.push({ index, role: 'Assistant', content: entry.data.reasoningText ? `${entry.data.reasoningText}\n\n${entry.data.content}` : entry.data.content });
				} else if (entry.type === 'tool.execution_complete' && entry.data.result?.content) {
					messages.push({ index, role: entry.data.success ? 'Tool' : 'Tool error', content: entry.data.result.content });
				}
			} catch {
				messages.push({ index, role: 'Raw', content: line });
			}
		}

		this.logService.trace(`[ChatSearchPanel] Parsed ${messages.length} messages from ${transcriptUri.toString()}`);
		return messages;
	}

	private _postState(): void {
		if (!this._panel) {
			return;
		}

		const state: IPanelState = {
			sessionResource: this._sessionResource?.toString(),
			query: this._currentQuery,
			options: this._currentOptions,
			messages: this._messages,
			results: this._currentResults,
			currentMatchIndex: this._currentMatchIndex,
			loading: this._loading,
			status: this._status,
		};

		void this._panel.webview.postMessage({ command: 'state', state });
	}

	private _getHtml(webview: vscode.Webview): string {
		const nonce = this._getNonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chat Search</title>
<style>
	:root {
		color-scheme: light dark;
	}
	body {
		margin: 0;
		padding: 0;
		font-family: var(--vscode-font-family);
		color: var(--vscode-foreground);
		background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, #111 8%), var(--vscode-editor-background));
	}
	.shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.header {
		padding: 16px;
		border-bottom: 1px solid var(--vscode-panel-border);
		background: color-mix(in srgb, var(--vscode-editor-background) 82%, var(--vscode-panel-background) 18%);
	}
	.title {
		font-size: 16px;
		font-weight: 700;
		margin-bottom: 10px;
	}
	.searchRow {
		display: grid;
		grid-template-columns: 1fr auto auto auto auto;
		gap: 8px;
		align-items: center;
	}
	input[type="text"] {
		padding: 10px 12px;
		border-radius: 8px;
		border: 1px solid var(--vscode-input-border);
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
	}
	button {
		padding: 9px 12px;
		border: 1px solid var(--vscode-button-border, transparent);
		border-radius: 8px;
		background: var(--vscode-button-secondaryBackground);
		color: var(--vscode-button-secondaryForeground);
		cursor: pointer;
	}
	button.active {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}
	.meta {
		display: flex;
		gap: 12px;
		align-items: center;
		margin-top: 10px;
		font-size: 12px;
		opacity: 0.86;
	}
	.body {
		flex: 1;
		overflow: auto;
		padding: 16px;
	}
	.message {
		padding: 12px 14px;
		margin-bottom: 12px;
		border: 1px solid var(--vscode-panel-border);
		border-radius: 12px;
		background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-panel-background) 12%);
	}
	.message.current {
		border-color: var(--vscode-editor-findMatchBorder, var(--vscode-focusBorder));
		box-shadow: 0 0 0 1px var(--vscode-editor-findMatchBorder, var(--vscode-focusBorder)) inset;
	}
	.messageHeader {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 8px;
		font-size: 12px;
		opacity: 0.9;
	}
	.messageContent {
		white-space: pre-wrap;
		line-height: 1.5;
		word-break: break-word;
	}
	mark.match {
		background: var(--vscode-editor-findMatchBackground);
		color: var(--vscode-editor-foreground);
		padding: 0 2px;
		border-radius: 3px;
	}
	mark.match.current {
		background: var(--vscode-editor-findMatchHighlightBackground);
		outline: 1px solid var(--vscode-editor-findMatchBorder, var(--vscode-focusBorder));
	}
	.empty {
		padding: 20px;
		text-align: center;
		opacity: 0.7;
	}
</style>
</head>
<body>
<div class="shell">
	<div class="header">
		<div class="title">Chat Search</div>
		<div class="searchRow">
			<input id="query" type="text" placeholder="Search transcript" aria-label="Search transcript" />
			<button id="matchCase" title="Match case">Aa</button>
			<button id="wholeWord" title="Whole word">Ab</button>
			<button id="regex" title="Regex">.*</button>
			<button id="close" title="Close search">×</button>
		</div>
		<div class="meta">
			<span id="status">Loading...</span>
			<span id="count">0 matches</span>
		</div>
	</div>
	<div id="body" class="body"></div>
</div>
<script nonce="${nonce}">
(function() {
	const vscode = acquireVsCodeApi();
	const queryInput = document.getElementById('query');
	const matchCaseButton = document.getElementById('matchCase');
	const wholeWordButton = document.getElementById('wholeWord');
	const regexButton = document.getElementById('regex');
	const closeButton = document.getElementById('close');
	const body = document.getElementById('body');
	const status = document.getElementById('status');
	const count = document.getElementById('count');

	let currentState = {
		query: '',
		options: { matchCase: false, matchWholeWord: false, useRegexPattern: false },
		messages: [],
		results: [],
		currentMatchIndex: -1,
		loading: true,
		status: 'Loading...'
	};

	function escapeHtml(value) {
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function isActive(button, active) {
		button.classList.toggle('active', !!active);
	}

	function render() {
		queryInput.value = currentState.query || '';
		isActive(matchCaseButton, currentState.options.matchCase);
		isActive(wholeWordButton, currentState.options.matchWholeWord);
		isActive(regexButton, currentState.options.useRegexPattern);
		status.textContent = currentState.status;
		count.textContent = currentState.results.length === 1 ? '1 match' : currentState.results.length + ' matches';

		if (!currentState.messages.length) {
			body.innerHTML = '<div class="empty">No transcript loaded for the current session.</div>';
			return;
		}

		const resultMap = new Map();
		currentState.results.forEach((result, resultIndex) => {
			resultMap.set(result.messageIndex, { result, resultIndex });
		});

		body.innerHTML = currentState.messages.map((message) => {
			const info = resultMap.get(message.index);
			const isCurrent = info && info.resultIndex === currentState.currentMatchIndex;
			const highlighted = info ? renderHighlights(message.content, info.result.matches, isCurrent) : escapeHtml(message.content);
			return '<div class="message ' + (isCurrent ? 'current' : '') + '" data-message-index="' + message.index + '">' +
				'<div class="messageHeader"><span>' + escapeHtml(message.role) + '</span><span>#' + (message.index + 1) + '</span></div>' +
				'<div class="messageContent">' + highlighted + '</div>' +
			'</div>';
		}).join('');

		const currentCard = body.querySelector('.message.current');
		if (currentCard) {
			currentCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	}

	function renderHighlights(content, matches, current) {
		if (!matches || !matches.length) {
			return escapeHtml(content);
		}
		const sorted = [...matches].sort((a, b) => a.startIndex - b.startIndex);
		let result = '';
		let cursor = 0;
		sorted.forEach((match, index) => {
			result += escapeHtml(content.slice(cursor, match.startIndex));
			const cls = 'match' + (current && index === 0 ? ' current' : '');
				result += '<mark class="' + cls + '">' + escapeHtml(content.slice(match.startIndex, match.endIndex)) + '</mark>';
			cursor = match.endIndex;
		});
		result += escapeHtml(content.slice(cursor));
		return result;
	}

	function sendQueryChange() {
		vscode.postMessage({
			command: 'queryChanged',
			query: queryInput.value,
			options: currentState.options,
		});
	}

	queryInput.addEventListener('input', sendQueryChange);
	queryInput.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			vscode.postMessage({ command: event.shiftKey ? 'previous' : 'next' });
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			vscode.postMessage({ command: 'close' });
		}
	});

	matchCaseButton.addEventListener('click', () => {
		currentState.options.matchCase = !currentState.options.matchCase;
		sendQueryChange();
	});

	wholeWordButton.addEventListener('click', () => {
		currentState.options.matchWholeWord = !currentState.options.matchWholeWord;
		sendQueryChange();
	});

	regexButton.addEventListener('click', () => {
		currentState.options.useRegexPattern = !currentState.options.useRegexPattern;
		sendQueryChange();
	});

	closeButton.addEventListener('click', () => vscode.postMessage({ command: 'close' }));

	window.addEventListener('message', (event) => {
		const message = event.data;
		if (message?.command === 'state') {
			currentState = message.state;
			render();
		}
	});

	vscode.postMessage({ command: 'ready' });
	queryInput.focus();
})();
</script>
</body>
</html>`;
	}

	private _getNonce(): string {
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let text = '';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}
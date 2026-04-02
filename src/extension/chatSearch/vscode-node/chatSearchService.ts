/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../platform/log/common/logService';
import { Emitter } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IChatSearchOptions, IChatSearchResult, IChatSearchService } from '../common/chatSearchService';

/**
 * Core search service for chat - pure business logic without DOM dependencies
 * Runs in Node.js extension host context
 */
export class ChatSearchService extends Disposable implements IChatSearchService {
	declare _serviceBrand: undefined;

	private _currentQuery: string = '';
	private _results: IChatSearchResult[] = [];
	private _currentMatchIndex: number = 0;
	private _options: IChatSearchOptions = {};
	private _chatMessages: string[] = [];

	private readonly _onSearchResultsChanged = new Emitter<IChatSearchResult[]>();
	private readonly _onCurrentMatchChanged = new Emitter<number>();

	constructor(@ILogService private readonly logService: ILogService) {
		super();
	}

	/**
	 * Perform search across chat messages
	 */
	search(query: string, options?: IChatSearchOptions): IChatSearchResult[] {
		if (!query) {
			this._results = [];
			this._currentMatchIndex = 0;
			this._currentQuery = '';
			this._options = {};
			this._onSearchResultsChanged.fire(this._results);
			return [];
		}

		this._currentQuery = query;
		this._options = options || {};
		this._currentMatchIndex = 0;

		try {
			this._results = this._performSearch(query, options);
			this._onSearchResultsChanged.fire(this._results);
		} catch (error) {
			this.logService.error(`Search failed: ${String(error)}`);
			this._results = [];
			this._onSearchResultsChanged.fire(this._results);
		}

		return this._results;
	}

	/**
	 * Internal search implementation
	 */
	private _performSearch(
		query: string,
		options?: IChatSearchOptions,
	): IChatSearchResult[] {
		const results: IChatSearchResult[] = [];
		const searchRegex = this._buildSearchRegex(query, options);

		this._chatMessages.forEach((message, index) => {
			const matches = this._findMatches(message, searchRegex);

			if (matches.length > 0) {
				results.push({
					message,
					messageIndex: index,
					matches,
				});
			}
		});

		return results;
	}

	/**
	 * Build regex pattern for search
	 */
	private _buildSearchRegex(query: string, options?: IChatSearchOptions): RegExp {
		let pattern = query;

		// Escape special regex characters if not using regex pattern
		if (!options?.useRegexPattern) {
			pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}

		// Add word boundary if whole word search is enabled
		if (options?.matchWholeWord) {
			pattern = `\\b${pattern}\\b`;
		}

		const flags = options?.matchCase ? 'g' : 'gi';

		try {
			return new RegExp(pattern, flags);
		} catch (error) {
			// Fall back to literal search on regex error
			this.logService.warn(
				`Failed to create regex pattern "${pattern}", falling back to literal search`,
			);
			const escapedPattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			return new RegExp(escapedPattern, flags);
		}
	}

	/**
	 * Find all matches of the regex in text
	 */
	private _findMatches(
		text: string,
		regex: RegExp,
	): Array<{ startIndex: number; endIndex: number; text: string }> {
		const matches: Array<{ startIndex: number; endIndex: number; text: string }> = [];
		let match;

		// Create a new regex instance to reset lastIndex
		const searchRegex = new RegExp(regex.source, regex.flags);

		try {
			while ((match = searchRegex.exec(text)) !== null) {
				matches.push({
					startIndex: match.index,
					endIndex: match.index + match[0].length,
					text: match[0],
				});
			}
		} catch (error) {
			this.logService.warn(`Match extraction failed: ${String(error)}`);
		}

		return matches;
	}

	/**
	 * Navigate to next match
	 */
	goToNextMatch(): void {
		if (this._results.length === 0) {
			return;
		}

		this._currentMatchIndex = (this._currentMatchIndex + 1) % this._results.length;
		this._onCurrentMatchChanged.fire(this._currentMatchIndex);
	}

	/**
	 * Navigate to previous match
	 */
	goToPreviousMatch(): void {
		if (this._results.length === 0) {
			return;
		}

		this._currentMatchIndex =
			(this._currentMatchIndex - 1 + this._results.length) % this._results.length;
		this._onCurrentMatchChanged.fire(this._currentMatchIndex);
	}

	/**
	 * Get current match index
	 */
	getCurrentMatchIndex(): number {
		return this._currentMatchIndex;
	}

	/**
	 * Get current search query
	 */
	getCurrentQuery(): string {
		return this._currentQuery;
	}

	/**
	 * Get all search results
	 */
	getResults(): IChatSearchResult[] {
		return this._results;
	}

	/**
	 * Clear search results
	 */
	clearSearch(): void {
		this._currentQuery = '';
		this._results = [];
		this._currentMatchIndex = 0;
		this._options = {};
		this._onSearchResultsChanged.fire([]);
	}

	/**
	 * Update messages to search in
	 */
	setMessages(messages: string[]): void {
		this._chatMessages = messages;

		// Re-search if there's an active query
		if (this._currentQuery) {
			this.search(this._currentQuery, this._options);
		}
	}

	/**
	 * Event: search results changed
	 */
	onSearchResultsChanged(callback: (results: IChatSearchResult[]) => void) {
		return this._onSearchResultsChanged.event(callback);
	}

	/**
	 * Event: current match changed
	 */
	onCurrentMatchChanged(callback: (index: number) => void) {
		return this._onCurrentMatchChanged.event(callback);
	}
}

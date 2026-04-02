/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { IDisposable } from '../../../util/vs/base/common/lifecycle';

export const IChatSearchService = createServiceIdentifier<IChatSearchService>('IChatSearchService');

export interface IChatSearchOptions {
	matchCase?: boolean;
	matchWholeWord?: boolean;
	useRegexPattern?: boolean;
}

export interface IChatSearchResult {
	message: string;
	messageIndex: number;
	matches: Array<{
		startIndex: number;
		endIndex: number;
		text: string;
	}>;
}

export interface IChatSearchService {
	readonly _serviceBrand: undefined;

	/**
	 * Search for a query string in the current chat messages
	 */
	search(query: string, options?: IChatSearchOptions): IChatSearchResult[];

	/**
	 * Get the current search query
	 */
	getCurrentQuery(): string;

	/**
	 * Get all search results for the current query
	 */
	getResults(): IChatSearchResult[];

	/**
	 * Navigate to the next match
	 */
	goToNextMatch(): void;

	/**
	 * Navigate to the previous match
	 */
	goToPreviousMatch(): void;

	/**
	 * Get current match index
	 */
	getCurrentMatchIndex(): number;

	/**
	 * Clear search results
	 */
	clearSearch(): void;

	/**
	 * Register an observer to be notified when search results change
	 */
	onSearchResultsChanged(callback: (results: IChatSearchResult[]) => void): IDisposable;

	/**
	 * Register an observer for current match changes
	 */
	onCurrentMatchChanged(callback: (index: number) => void): IDisposable;

	/**
	 * Update the messages to search in
	 */
	setMessages(messages: string[]): void;
}

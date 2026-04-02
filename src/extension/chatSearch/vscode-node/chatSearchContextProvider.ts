/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatSearchService } from '../common/chatSearchService';

/**
 * Context for managing chat search state and message extraction
 * This is a thin wrapper around the search service for context-specific logic
 */
export class ChatSearchContextProvider extends Disposable {
	private _isSearching = false;

	constructor(
		private readonly chatSearchService: IChatSearchService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	/**
	 * Initialize search with a list of messages from the chat session
	 */
	initializeSearch(messages: string[]): void {
		try {
			this.chatSearchService.setMessages(messages);
			this._isSearching = true;
		} catch (error) {
			this.logService.error(
				`[ChatSearchContextProvider] Failed to initialize search: ${String(error)}`,
			);
		}
	}

	/**
	 * Close search context
	 */
	closeSearch(): void {
		try {
			this.chatSearchService.clearSearch();
			this._isSearching = false;
		} catch (error) {
			this.logService.error(
				`[ChatSearchContextProvider] Failed to close search: ${String(error)}`,
			);
		}
	}

	/**
	 * Check if search is currently active
	 */
	isSearching(): boolean {
		return this._isSearching;
	}
}

import "server-only";
import { env } from "@/lib/env";
import { apiFetch } from "./http";
import {
  IntegrationError,
  MissingCredentialsError,
  type ConnectionTest,
} from "./types";

/**
 * Monday.com — GraphQL API v2.
 *
 * Endpoint en versiebeheer volgens de officiële documentatie: alle aanvragen
 * gaan naar https://api.monday.com/v2 met een `Authorization`-header (het token
 * zonder "Bearer") en een `API-Version`-header. De versie staat in
 * MONDAY_API_VERSION zodat we die kunnen bijstellen zonder code te wijzigen.
 */
const ENDPOINT = "https://api.monday.com/v2";

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
  error_message?: string;
};

export type MondayBoard = {
  id: string;
  name: string;
  description: string | null;
  state: string;
  board_kind: string;
  items_count: number | null;
  groups: Array<{ id: string; title: string }>;
  columns: Array<{ id: string; title: string; type: string; settings_str: string }>;
};

export type MondayItem = {
  id: string;
  name: string;
  state: string;
  created_at: string;
  updated_at: string;
  group: { id: string; title: string } | null;
  column_values: Array<{ id: string; text: string | null; type: string; value: string | null }>;
};

export class MondayService {
  constructor(private token = env.MONDAY_API_TOKEN) {}

  get isConfigured(): boolean {
    return Boolean(this.token);
  }

  private requireToken(): string {
    if (!this.token) throw new MissingCredentialsError("monday", ["MONDAY_API_TOKEN"]);
    return this.token;
  }

  private async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const token = this.requireToken();
    const result = await apiFetch<GraphQLResponse<T>>("monday", ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: token,
        "API-Version": env.MONDAY_API_VERSION,
      },
      body: { query, variables },
    });

    if (result.errors?.length) {
      throw new IntegrationError(
        "monday",
        result.errors.map((e) => e.message).join("; "),
        400,
        false,
        result.errors,
      );
    }
    if (result.error_message) {
      throw new IntegrationError("monday", result.error_message, 400);
    }
    if (!result.data) {
      throw new IntegrationError("monday", "Leeg antwoord van Monday", 500, true);
    }
    return result.data;
  }

  async testConnection(): Promise<ConnectionTest> {
    if (!this.isConfigured) {
      return {
        ok: false,
        message: "Nog niet ingesteld: MONDAY_API_TOKEN ontbreekt.",
      };
    }
    try {
      const data = await this.query<{ me: { name: string; email: string }; account?: { name: string } }>(
        `query { me { name email } }`,
      );
      return {
        ok: true,
        message: `Verbonden als ${data.me.name} (${data.me.email}).`,
        detail: { user: data.me },
      };
    } catch (error) {
      const err = error as IntegrationError;
      return { ok: false, message: err.userMessage ?? "Verbinding mislukt.", detail: { error: err.message } };
    }
  }

  /** Alle boards, voor het mappingscherm. Geen aannames over board-ID's. */
  async listBoards(limit = 100): Promise<MondayBoard[]> {
    const data = await this.query<{ boards: MondayBoard[] }>(
      `query ($limit: Int!) {
        boards(limit: $limit, order_by: used_at) {
          id name description state board_kind items_count
          groups { id title }
          columns { id title type settings_str }
        }
      }`,
      { limit },
    );
    return data.boards ?? [];
  }

  async getBoard(boardId: string): Promise<MondayBoard | null> {
    const data = await this.query<{ boards: MondayBoard[] }>(
      `query ($ids: [ID!]) {
        boards(ids: $ids) {
          id name description state board_kind items_count
          groups { id title }
          columns { id title type settings_str }
        }
      }`,
      { ids: [boardId] },
    );
    return data.boards?.[0] ?? null;
  }

  /** Items ophalen met cursor-paginering, zodat grote boards ook werken. */
  async *iterateItems(boardId: string, pageSize = 100): AsyncGenerator<MondayItem[]> {
    let cursor: string | null = null;
    do {
      const data: { boards: Array<{ items_page: { cursor: string | null; items: MondayItem[] } }> } =
        await this.query(
          `query ($ids: [ID!], $limit: Int!, $cursor: String) {
            boards(ids: $ids) {
              items_page(limit: $limit, cursor: $cursor) {
                cursor
                items {
                  id name state created_at updated_at
                  group { id title }
                  column_values { id text type value }
                }
              }
            }
          }`,
          { ids: [boardId], limit: pageSize, cursor },
        );

      const page = data.boards?.[0]?.items_page;
      if (!page) return;
      yield page.items;
      cursor = page.cursor;
    } while (cursor);
  }

  async listItems(boardId: string, max = 500): Promise<MondayItem[]> {
    const out: MondayItem[] = [];
    for await (const batch of this.iterateItems(boardId)) {
      out.push(...batch);
      if (out.length >= max) break;
    }
    return out.slice(0, max);
  }

  async listUsers(): Promise<Array<{ id: string; name: string; email: string }>> {
    const data = await this.query<{ users: Array<{ id: string; name: string; email: string }> }>(
      `query { users(limit: 200) { id name email } }`,
    );
    return data.users ?? [];
  }

  /** Kolomwaarde terugschrijven — alleen gebruikt bij tweerichtingssync. */
  async updateColumnValue(
    boardId: string,
    itemId: string,
    columnId: string,
    value: unknown,
  ): Promise<void> {
    await this.query(
      `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
      }`,
      { boardId, itemId, columnId, value: JSON.stringify(value) },
    );
  }

  async createWebhook(boardId: string, url: string, event: string): Promise<{ id: string }> {
    const data = await this.query<{ create_webhook: { id: string } }>(
      `mutation ($boardId: ID!, $url: String!, $event: WebhookEventType!) {
        create_webhook(board_id: $boardId, url: $url, event: $event) { id }
      }`,
      { boardId, url, event },
    );
    return data.create_webhook;
  }
}

export const monday = new MondayService();

import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export interface SearchResult {
  id: string;
  type: "asset" | "bridge" | "pool" | "documentation";
  title: string;
  description: string;
  relevanceScore: number;
  highlights: string[];
  metadata: Record<string, unknown>;
}

export interface SearchQuery {
  query: string;
  type?: "asset" | "bridge" | "pool" | "documentation";
  limit?: number;
  offset?: number;
  fuzzy?: boolean;
  filters?: Record<string, unknown>;
}

export interface SearchSuggestion {
  text: string;
  type: string;
  count: number;
}

export interface SearchAnalytics {
  query: string;
  userId?: string;
  resultsCount: number;
  timestamp: Date;
  clickedResult?: string;
}

export class SearchService {
  private db = getDatabase();

  /**
   * Perform full-text search across all entities
   */
  async search(searchQuery: SearchQuery): Promise<{ results: SearchResult[]; total: number }> {
    logger.info(searchQuery, "Performing search");

    const { query, type, limit = 20, offset = 0, fuzzy = true, filters = {} } = searchQuery;
    
    if (!query || query.trim().length < 2) {
      return { results: [], total: 0 };
    }

    // Track search analytics
    await this.trackSearchAnalytics(query);

    const searchTerms = this.parseSearchQuery(query, fuzzy);
    const results: SearchResult[] = [];

    // Search across different entity types
    if (!type || type === "asset") {
      const assetResults = await this.searchAssets(searchTerms, filters);
      results.push(...assetResults);
    }

    if (!type || type === "bridge") {
      const bridgeResults = await this.searchBridges(searchTerms, filters);
      results.push(...bridgeResults);
    }

    if (!type || type === "pool") {
      const poolResults = await this.searchPools(searchTerms, filters);
      results.push(...poolResults);
    }

    if (!type || type === "documentation") {
      const docResults = await this.searchDocumentation(searchTerms, filters);
      results.push(...docResults);
    }

    // Sort by relevance score and paginate
    const sortedResults = results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(offset, offset + limit);

    return {
      results: sortedResults,
      total: results.length,
    };
  }

  /**
   * Get search suggestions/autocomplete
   */
  async getSuggestions(query: string, limit = 10): Promise<SearchSuggestion[]> {
    logger.info({ query, limit }, "Getting search suggestions");

    if (!query || query.trim().length < 2) {
      return [];
    }

    const suggestions: SearchSuggestion[] = [];

    // Asset symbol/name suggestions
    const assetSuggestions = await this.db("assets")
      .where("symbol", "ILIKE", `%${query}%`)
      .orWhere("name", "ILIKE", `%${query}%`)
      .select("symbol", "name")
      .limit(limit / 2);

    suggestions.push(
      ...assetSuggestions.map(asset => ({
        text: `${asset.symbol} - ${asset.name}`,
        type: "asset",
        count: 1,
      }))
    );

    // Bridge name suggestions
    const bridgeSuggestions = await this.db("bridges")
      .where("name", "ILIKE", `%${query}%`)
      .select("name")
      .limit(limit / 2);

    suggestions.push(
      ...bridgeSuggestions.map(bridge => ({
        text: bridge.name,
        type: "bridge",
        count: 1,
      }))
    );

    return suggestions.slice(0, limit);
  }

  /**
   * Get recent searches for a user
   */
  async getRecentSearches(userId?: string, limit = 10): Promise<string[]> {
    const query = this.db("search_analytics")
      .select("query")
      .orderBy("timestamp", "desc")
      .limit(limit);

    if (userId) {
      query.where("user_id", userId);
    } else {
      query.whereNull("user_id");
    }

    const results = await query.distinct("query");
    return results.map(r => r.query);
  }

  /**
   * Track search analytics
   */
  async trackSearchAnalytics(query: string, userId?: string): Promise<void> {
    await this.db("search_analytics").insert({
      query,
      user_id: userId,
      timestamp: new Date(),
    });
  }

  /**
   * Track result click
   */
  async trackResultClick(query: string, resultId: string, userId?: string): Promise<void> {
    await this.db("search_analytics")
      .where("query", query)
      .where("user_id", userId || null)
      .orderBy("timestamp", "desc")
      .limit(1)
      .update({ clicked_result: resultId });
  }

  /**
   * Rebuild search index
   */
  async rebuildSearchIndex(): Promise<void> {
    logger.info("Rebuilding search index");

    // This would typically update a dedicated search index like Elasticsearch
    // For now, we'll ensure database indexes are optimized
    await this.db.raw("ANALYZE");
    await this.db.raw("REINDEX DATABASE bridge_watch");
  }

  /**
   * Search assets
   */
  private async searchAssets(
    searchTerms: string[],
    filters: Record<string, unknown>
  ): Promise<SearchResult[]> {
    let query = this.db("assets")
      .select(
        "id",
        "symbol as title",
        "name",
        "bridge_provider",
        "source_chain",
        "is_active"
      )
      .where("is_active", true);

    // Apply search terms
    searchTerms.forEach(term => {
      query = query.andWhere(function() {
        this.where("symbol", "ILIKE", `%${term}%`)
            .orWhere("name", "ILIKE", `%${term}%`)
            .orWhere("bridge_provider", "ILIKE", `%${term}%`);
      });
    });

    // Apply filters
    if (filters.bridge_provider) {
      query = query.where("bridge_provider", filters.bridge_provider);
    }

    if (filters.source_chain) {
      query = query.where("source_chain", filters.source_chain);
    }

    const assets = await query;

    return assets.map(asset => ({
      id: asset.id,
      type: "asset" as const,
      title: asset.title,
      description: `${asset.name} - ${asset.bridge_provider || 'Native'} on ${asset.source_chain || 'Stellar'}`,
      relevanceScore: this.calculateRelevanceScore(searchTerms, asset.title, asset.name),
      highlights: this.generateHighlights(searchTerms, [asset.title, asset.name]),
      metadata: {
        symbol: asset.title,
        bridgeProvider: asset.bridge_provider,
        sourceChain: asset.source_chain,
        isActive: asset.is_active,
      },
    }));
  }

  /**
   * Search bridges
   */
  private async searchBridges(
    searchTerms: string[],
    filters: Record<string, unknown>
  ): Promise<SearchResult[]> {
    let query = this.db("bridges")
      .select(
        "id",
        "name as title",
        "source_chain",
        "status",
        "total_value_locked",
        "is_active"
      )
      .where("is_active", true);

    // Apply search terms
    searchTerms.forEach(term => {
      query = query.andWhere(function() {
        this.where("name", "ILIKE", `%${term}%`)
            .orWhere("source_chain", "ILIKE", `%${term}%`);
      });
    });

    // Apply filters
    if (filters.source_chain) {
      query = query.where("source_chain", filters.source_chain);
    }

    if (filters.status) {
      query = query.where("status", filters.status);
    }

    const bridges = await query;

    return bridges.map(bridge => ({
      id: bridge.id,
      type: "bridge" as const,
      title: bridge.title,
      description: `${bridge.source_chain} bridge - Status: ${bridge.status}, TVL: $${Number(bridge.total_value_locked).toLocaleString()}`,
      relevanceScore: this.calculateRelevanceScore(searchTerms, bridge.title, bridge.source_chain),
      highlights: this.generateHighlights(searchTerms, [bridge.title, bridge.source_chain]),
      metadata: {
        sourceChain: bridge.source_chain,
        status: bridge.status,
        totalValueLocked: Number(bridge.total_value_locked),
        isActive: bridge.is_active,
      },
    }));
  }

  /**
   * Search liquidity pools
   */
  private async searchPools(
    searchTerms: string[],
    filters: Record<string, unknown>
  ): Promise<SearchResult[]> {
    let query = this.db("liquidity_pools")
      .select(
        "id",
        "dex",
        "asset_a",
        "asset_b",
        "total_liquidity",
        "health_score"
      );

    // Apply search terms
    searchTerms.forEach(term => {
      query = query.andWhere(function() {
        this.where("asset_a", "ILIKE", `%${term}%`)
            .orWhere("asset_b", "ILIKE", `%${term}%`)
            .orWhere("dex", "ILIKE", `%${term}%`);
      });
    });

    // Apply filters
    if (filters.dex) {
      query = query.where("dex", filters.dex);
    }

    if (filters.min_liquidity) {
      query = query.where("total_liquidity", ">=", filters.min_liquidity);
    }

    if (filters.min_health_score) {
      query = query.where("health_score", ">=", filters.min_health_score);
    }

    const pools = await query;

    return pools.map(pool => ({
      id: pool.id,
      type: "pool" as const,
      title: `${pool.asset_a}/${pool.asset_b} on ${pool.dex}`,
      description: `Liquidity: $${Number(pool.total_liquidity).toLocaleString()}, Health: ${pool.health_score}/100`,
      relevanceScore: this.calculateRelevanceScore(searchTerms, pool.asset_a, pool.asset_b, pool.dex),
      highlights: this.generateHighlights(searchTerms, [pool.asset_a, pool.asset_b, pool.dex]),
      metadata: {
        assetA: pool.asset_a,
        assetB: pool.asset_b,
        dex: pool.dex,
        totalLiquidity: Number(pool.total_liquidity),
        healthScore: pool.health_score,
      },
    }));
  }

  /**
   * Search documentation (mock implementation)
   */
  private async searchDocumentation(
    searchTerms: string[],
    filters: Record<string, unknown>
  ): Promise<SearchResult[]> {
    // This would typically integrate with a documentation system
    // For now, return mock documentation results
    const mockDocs = [
      {
        id: "doc-1",
        title: "Getting Started with Bridge Watch",
        content: "Learn how to monitor cross-chain bridges on Stellar",
        category: "tutorial",
      },
      {
        id: "doc-2", 
        title: "API Reference",
        content: "Complete API documentation for Bridge Watch endpoints",
        category: "reference",
      },
      {
        id: "doc-3",
        title: "Liquidity Pool Monitoring",
        content: "Understanding liquidity pool metrics and health scoring",
        category: "guide",
      },
    ];

    return mockDocs
      .filter(doc => 
        searchTerms.some(term =>
          doc.title.toLowerCase().includes(term.toLowerCase()) ||
          doc.content.toLowerCase().includes(term.toLowerCase())
        )
      )
      .map(doc => ({
        id: doc.id,
        type: "documentation" as const,
        title: doc.title,
        description: doc.content,
        relevanceScore: this.calculateRelevanceScore(searchTerms, doc.title, doc.content),
        highlights: this.generateHighlights(searchTerms, [doc.title, doc.content]),
        metadata: {
          category: doc.category,
        },
      }));
  }

  /**
   * Parse search query into terms with fuzzy matching
   */
  private parseSearchQuery(query: string, fuzzy: boolean): string[] {
    const terms = query.trim().split(/\s+/);
    
    if (!fuzzy) {
      return terms;
    }

    // Add fuzzy variations for each term
    const fuzzyTerms: string[] = [];
    terms.forEach(term => {
      fuzzyTerms.push(term);
      
      // Add common variations
      if (term.length > 3) {
        fuzzyTerms.push(term.slice(0, -1)); // Remove last character
        fuzzyTerms.push(term.slice(1)); // Remove first character
      }
      
      // Add plural/singular variations
      if (term.endsWith('s')) {
        fuzzyTerms.push(term.slice(0, -1));
      } else {
        fuzzyTerms.push(term + 's');
      }
    });

    return [...new Set(fuzzyTerms)];
  }

  /**
   * Calculate relevance score for search results
   */
  private calculateRelevanceScore(searchTerms: string[], ...fields: string[]): number {
    let score = 0;
    const allText = fields.join(' ').toLowerCase();
    
    searchTerms.forEach(term => {
      const lowerTerm = term.toLowerCase();
      
      // Exact match gets highest score
      fields.forEach(field => {
        if (field.toLowerCase() === lowerTerm) {
          score += 100;
        } else if (field.toLowerCase().includes(lowerTerm)) {
          score += 50;
        }
      });
      
      // Partial matches get lower score
      if (allText.includes(lowerTerm)) {
        score += 10;
      }
    });

    return score;
  }

  /**
   * Generate search highlights
   */
  private generateHighlights(searchTerms: string[], texts: string[]): string[] {
    const highlights: string[] = [];
    
    texts.forEach(text => {
      searchTerms.forEach(term => {
        const regex = new RegExp(`(${term})`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          highlights.push(...matches.slice(0, 3)); // Limit to 3 highlights per text
        }
      });
    });

    return [...new Set(highlights)];
  }
}

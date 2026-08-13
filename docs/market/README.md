# MonaRadar Market design index

This directory is the Phase 2 design baseline. No API client, service key, database migration, Collector action, Search, Dash or Analysis implementation is included.

- `API_INVENTORY.md`: official operation/request/response inventory and approval boundary
- `DATA_RELATIONSHIPS.md`: keys, cardinalities and confidence-rated links
- `MARKET_SCHEMA.md`: proposed SQLite entities, constraints and indexes
- `COLLECTOR_STRATEGY.md`: manual period/incremental collection, checkpoints and failure policy
- `RAW_DATA_STRATEGY.md`: raw response/item retention and lineage
- `API_VERIFICATION_CHECKLIST.md`: facts requiring minimal live calls later
- `IMPLEMENTATION_PLAN.md`: staged Phase 3 work
- `PHASE3A_API_CLIENT.md`: implemented backend client foundation and verified test contract

Evidence priority: official DOCX → later redacted live fixtures → implementation. When evidence conflicts, update the documents and record the verification result before changing schema constraints.

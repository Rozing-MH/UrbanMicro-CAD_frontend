export type ValidationRuleType =
  | 'LANE_CONNECTOR'
  | 'LANE_RESTRICTION'
  | 'LANE_ARROW'
  | 'TURN_RESTRICTION'
  | 'TRAFFIC_LIGHT'
  | 'CROSSWALK'
  | 'SENSOR'

export type ValidationCheckId =
  | 'DANGLING_LANE_REF'
  | 'DANGLING_NODE_REF'
  | 'DANGLING_SEGMENT_REF'
  | 'CROSS_NODE_CONNECTOR'
  | 'DEAD_END_INCOMING'
  | 'DEAD_END_OUTGOING'
  | 'SIGNAL_DUPLICATE_GREEN_LANE'
  | 'SIGNAL_GREEN_LANE_NOT_AT_NODE'
  | 'SIGNAL_NO_STEPS'
  | 'TURN_VS_CONNECTOR_CONFLICT'

export interface ValidationIssue {
  ruleType: ValidationRuleType
  checkId: ValidationCheckId
  severity: 'error' | 'warning'
  entityId: string
  message: string
  nodeId?: string
}

export interface ValidationResult {
  issues: ValidationIssue[]
  timestamp: number
}

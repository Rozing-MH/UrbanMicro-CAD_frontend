import { ref } from 'vue'
import type { ValidationResult } from '@/types/validation'
import { createValidationContext, validateRules } from '@/services/ruleValidation'

const lastResult = ref<ValidationResult | null>(null)

export function useRuleValidation() {
  function runValidation(): ValidationResult {
    const result = validateRules(createValidationContext())
    lastResult.value = result
    return result
  }

  return { lastResult, runValidation }
}

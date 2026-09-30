import { deepStrictEqual, throws } from "node:assert";
import { test } from "node:test";
import { BoundedStructuralValidationError } from "@ai-media-factory/runtime";
import { STRATEGY_COUNCIL_V2_EXAMPLES, validateStrategyCouncilSpecialistV2 } from "../dist/strategy-council-v2-specialists.js";

test("Writer rejects the observed provider failure class without coercion",()=>{
  const valid=STRATEGY_COUNCIL_V2_EXAMPLES.writer;
  const variants=[
    {...valid,contract:{}},
    {...valid,status:{}},
    {...valid,storytellingArchitecture:{}},
    {...valid,hookMechanics:{}},
    {...valid,repeatableSeries:{}},
    {...valid,repeatableSeries:[{series:"example",format:"example"}]},
    {...valid,specialist:"author"},
  ];
  for(const value of variants)throws(()=>validateStrategyCouncilSpecialistV2("writer",value),BoundedStructuralValidationError);
  throws(()=>JSON.parse('{"contract":'),SyntaxError);
  deepStrictEqual(validateStrategyCouncilSpecialistV2("writer",valid),valid);
});

import { extractWorldAndAuthorWithLLM } from '../extraction/llmExtractor';

async function main() {
  const result = await extractWorldAndAuthorWithLLM(
    'ワールド名: 桜の庭園\n作者様: sakura_creator'
  );
  console.log(JSON.stringify(result));
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});

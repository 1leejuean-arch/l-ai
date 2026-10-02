import "server-only";

import { toFile } from "openai";

import {
  getOpenAIClient,
  getOpenAIModel,
} from "@/lib/ai/openai";

export type LearnedProfileFact = {
  category: string;
  key: string;
  value: string;
};

type LearningAnalysisResult = {
  facts?: unknown;
};

function isLearnedProfileFact(
  value: unknown,
): value is LearnedProfileFact {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const record =
    value as Record<string, unknown>;

  return (
    typeof record.category === "string" &&
    record.category.trim().length > 0 &&
    typeof record.key === "string" &&
    record.key.trim().length > 0 &&
    typeof record.value === "string" &&
    record.value.trim().length > 0
  );
}

export async function extractProfileFacts(
  message: string,
): Promise<LearnedProfileFact[]> {
  const openai = getOpenAIClient();

  const response =
    await openai.responses.create({
      model: getOpenAIModel(),

      instructions: `
너는 L-AI의 장기기억 분석기다.

사용자가 자유롭게 말한 내용에서
앞으로도 기억할 가치가 있는 사용자 정보를 추출한다.

중요 규칙:

1. 사용자가 실제로 말한 내용만 저장한다.
2. 추측하거나 없는 정보를 만들어내지 않는다.
3. 일시적인 감정이나 순간 상태는 장기기억으로 저장하지 않는다.

예:
"오늘 피곤하다"
→ 저장하지 않음

"나는 보통 밤에 작업하는 걸 좋아해"
→ 저장 가능

4. 한 문장에 여러 정보가 있으면 각각 분리한다.

5. category는 다음 중 가장 가까운 것을 사용한다.

identity
preference
habit
communication
school
work
project
relationship
goal
other

6. key는 짧고 안정적인 영어 식별자로 만든다.

예:
name
birthday
favorite_food
development_guidance
current_project

7. value는 나중에 AI가 읽었을 때 의미를 정확히 이해할 수 있는
짧고 자연스러운 한국어로 작성한다.

8. 장기기억할 정보가 없다면 facts는 빈 배열로 반환한다.

반드시 JSON만 출력한다.

형식:

{
  "facts": [
    {
      "category": "identity",
      "key": "name",
      "value": "이주언"
    }
  ]
}
`,

      input: `
사용자가 사용자 정보 등록 모드에서 다음 내용을 말했다.

${message}

장기기억할 사용자 정보를 분석해.
`,
    });

  const raw =
    response.output_text.trim();

  if (!raw) {
    return [];
  }

  try {
    const cleaned = raw
      .replace(/^```json\s*/iu, "")
      .replace(/^```\s*/u, "")
      .replace(/\s*```$/u, "")
      .trim();

    const parsed =
      JSON.parse(
        cleaned,
      ) as LearningAnalysisResult;

    if (!Array.isArray(parsed.facts)) {
      return [];
    }

    return parsed.facts
      .filter(isLearnedProfileFact)
      .map((fact) => ({
        category:
          fact.category.trim(),
        key:
          fact.key.trim(),
        value:
          fact.value.trim(),
      }));
  } catch (error) {
    console.error(
      "[L-AI Learning] Failed to parse profile facts:",
      error,
    );

    return [];
  }
}

export async function extractProfileFactsFromFile(
  message: string,
  fileBase64: string,
  fileName: string,
  mimeType?: string,
): Promise<LearnedProfileFact[]> {
  const openai = getOpenAIClient();

  const fileBuffer =
    Buffer.from(
      fileBase64,
      "base64",
    );

  const uploadFile =
    await toFile(
      fileBuffer,
      fileName,
      {
        type:
          mimeType ||
          "application/octet-stream",
      },
    );

  const uploaded =
    await openai.files.create({
      file: uploadFile,
      purpose: "user_data",
    });

  try {
    const response =
      await openai.responses.create({
        model: getOpenAIModel(),

        instructions: `
너는 L-AI의 첨부파일 장기기억 후보 분석기다.

사용자가 첨부한 파일의 실제 내용에서
앞으로도 기억할 가치가 있는 사용자 정보를 추출한다.

중요:
이 단계에서는 정보를 실제 장기기억에 저장하지 않는다.
저장 여부를 사용자에게 확인하기 위한 "후보"만 추출한다.

규칙:

1. 첨부파일에 실제로 있는 정보만 사용한다.

2. 파일에 없는 정보는 추측하거나 만들어내지 않는다.

3. 사용자 본인에 대한 정보라고 명확하게 판단할 수 있는 정보만 추출한다.

4. 파일에 다른 사람의 정보가 함께 있다면
그 사람의 정보는 사용자 정보로 저장하지 않는다.

5. 사용자와 정보의 관계가 불분명하면 후보에서 제외한다.

6. 일시적인 정보보다 앞으로도 의미가 있는 정보를 우선한다.

예:
- 이름
- 생년월일
- 학교
- 학과
- 역할
- 활동
- 관심 분야
- 장기 프로젝트
- 목표
- 선호
등

7. 한 항목에 여러 정보가 있으면 각각 분리한다.

8. category는 다음 중 가장 가까운 것을 사용한다.

identity
preference
habit
communication
school
work
project
relationship
goal
other

9. key는 짧고 안정적인 영어 식별자로 만든다.

예:
name
birthday
school_name
club_role
current_project
career_goal

10. value는 나중에 AI가 읽었을 때 의미를 정확히 이해할 수 있는
짧고 자연스러운 한국어로 작성한다.

11. 장기기억 후보가 없다면 facts는 빈 배열로 반환한다.

반드시 JSON만 출력한다.

형식:

{
  "facts": [
    {
      "category": "school",
      "key": "school_name",
      "value": "영주고등학교"
    }
  ]
}
`,

        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `
사용자 요청:

${message}

첨부파일명:
${fileName}

이 첨부파일에서 사용자에 대한 장기기억 후보를 추출해.
`,
              },
              {
                type: "input_file",
                file_id: uploaded.id,
              },
            ],
          },
        ],
      });

    const raw =
      response.output_text.trim();

    if (!raw) {
      return [];
    }

    try {
      const cleaned = raw
        .replace(/^```json\s*/iu, "")
        .replace(/^```\s*/u, "")
        .replace(/\s*```$/u, "")
        .trim();

      const parsed =
        JSON.parse(
          cleaned,
        ) as LearningAnalysisResult;

      if (!Array.isArray(parsed.facts)) {
        return [];
      }

      return parsed.facts
        .filter(isLearnedProfileFact)
        .map((fact) => ({
          category:
            fact.category.trim(),
          key:
            fact.key.trim(),
          value:
            fact.value.trim(),
        }));
    } catch (error) {
      console.error(
        "[L-AI Learning] Failed to parse file profile facts:",
        error,
      );

      return [];
    }
  } finally {
    try {
      await openai.files.delete(
        uploaded.id,
      );
    } catch (error) {
      console.error(
        "[L-AI Learning] Temporary file cleanup failed:",
        error,
      );
    }
  }
}

export type LearningCandidateEdit = {
  action: "update" | "add" | "remove";
  category: string;
  key: string;
  value?: string;
};

type LearningCandidateEditAnalysisResult = {
  edits?: unknown;
};

export async function extractLearningCandidateEdits(
  message: string,
  currentFacts: LearnedProfileFact[],
): Promise<LearningCandidateEdit[]> {
  const openai = getOpenAIClient();

  const response =
    await openai.responses.create({
      model: getOpenAIModel(),

      instructions: `
너는 L-AI의 장기기억 후보 수정 분석기다.

사용자는 아직 저장되지 않은 장기기억 후보 목록을 보고
일부 항목을 수정, 추가, 삭제할 수 있다.

현재 후보 목록을 기준으로 사용자의 수정 요청을 분석한다.

가능한 action:

1. update
기존 후보의 값을 변경한다.

2. add
새로운 후보를 추가한다.

3. remove
기존 후보를 제거한다.

규칙:

- 사용자가 실제로 요청한 변경만 반영한다.
- 없는 내용을 추측하지 않는다.
- 기존 후보의 의미와 가장 가까운 category/key를 유지한다.
- 새 항목을 추가할 때 category는 다음 중 하나를 사용한다.

identity
preference
habit
communication
school
work
project
relationship
goal
other

- key는 짧고 안정적인 영어 식별자를 사용한다.

예:
name
age
birthday
school_name
club_role
career_goal
current_project

- update와 add에는 value가 반드시 있어야 한다.
- remove에는 value가 없어도 된다.
- 수정 요청이 없으면 edits는 빈 배열로 반환한다.

반드시 JSON만 출력한다.

형식:

{
  "edits": [
    {
      "action": "update",
      "category": "school",
      "key": "school_name",
      "value": "남녕고등학교"
    },
    {
      "action": "add",
      "category": "identity",
      "key": "age",
      "value": "19살"
    }
  ]
}
`,

      input: `
현재 장기기억 후보:

${currentFacts
  .map(
    (fact) =>
      `- [${fact.category}/${fact.key}] ${fact.value}`,
  )
  .join("\n")}

사용자 수정 요청:

${message}

사용자의 요청에 따라 후보 수정 작업을 분석해.
`,
    });

  const raw =
    response.output_text.trim();

  if (!raw) {
    return [];
  }

  try {
    const cleaned = raw
      .replace(/^```json\s*/iu, "")
      .replace(/^```\s*/u, "")
      .replace(/\s*```$/u, "")
      .trim();

    const parsed =
      JSON.parse(
        cleaned,
      ) as LearningCandidateEditAnalysisResult;

    if (!Array.isArray(parsed.edits)) {
      return [];
    }

    return parsed.edits
      .filter((edit): edit is Record<string, unknown> =>
        typeof edit === "object" &&
        edit !== null,
      )
      .filter((edit) => {
        const action = edit.action;

        return (
          (
            action === "update" ||
            action === "add" ||
            action === "remove"
          ) &&
          typeof edit.category === "string" &&
          edit.category.trim().length > 0 &&
          typeof edit.key === "string" &&
          edit.key.trim().length > 0 &&
          (
            action === "remove" ||
            (
              typeof edit.value === "string" &&
              edit.value.trim().length > 0
            )
          )
        );
      })
      .map((edit) => ({
        action:
          edit.action as
            | "update"
            | "add"
            | "remove",
        category:
          (edit.category as string).trim(),
        key:
          (edit.key as string).trim(),
        value:
          typeof edit.value === "string"
            ? edit.value.trim()
            : undefined,
      }));
  } catch (error) {
    console.error(
      "[L-AI Learning] Failed to parse candidate edits:",
      error,
    );

    return [];
  }
}

export type MemorySemanticIntent =
  | "recall"
  | "update"
  | "delete"
  | "add"
  | "none";

export type MemorySemanticResult = {
  intent: MemorySemanticIntent;
  relevantKeys: string[];
  confidence: number;
};

type MemorySemanticAnalysisResult = {
  intent?: unknown;
  relevantKeys?: unknown;
  confidence?: unknown;
};

export async function interpretMemoryRequest(
  message: string,
  currentFacts: LearnedProfileFact[],
): Promise<MemorySemanticResult> {
  const openai = getOpenAIClient();

  const availableFacts =
    currentFacts.length > 0
      ? currentFacts
          .map(
            (fact) =>
              `- [${fact.category}/${fact.key}] ${fact.value}`,
          )
          .join("\n")
      : "(저장된 사용자 정보 없음)";

  const response =
    await openai.responses.create({
      model: getOpenAIModel(),

      instructions: `
너는 L-AI의 사용자 장기기억 의미 해석기다.

사용자의 자연어 표현을 문자 그대로만 보지 말고
실제 의미와 의도를 이해해야 한다.

사용자는 매우 짧게 말하거나,
구어체, 반말, 줄임말, 애매한 표현을 사용할 수 있다.

예:

"나 어디 학교지?"
"내 학교 뭐더라ㅋㅋ"
"내가 다니는 학교 기억남?"
"학교 이름 뭐였지?"

위 표현들은 모두 학교에 대한 장기기억 조회(recall)로 이해해야 한다.

가능한 intent:

1. recall
저장된 사용자 정보를 물어보는 경우

예:
- 나 학교 어디지?
- 내 생일 언제였더라
- 나 방송부에서 뭐 했었지?
- 내가 좋아하는 거 뭐였지?
- 나에 대해 기억하는 거 알려줘

2. update
기존 사용자 정보를 수정하려는 경우

예:
- 내 학교 남녕고로 바꿔
- 생일 10월 30일 아니고 31일이야
- 내 목표 졸업으로 수정해

3. delete
기억된 사용자 정보를 삭제하려는 경우

예:
- 내 학교 정보 지워
- 생일 기억하지 마
- 방금 저장한 거 삭제해

4. add
새로운 사용자 정보를 기억시키려는 경우

예:
- 나 19살이야 기억해
- 내가 영상 편집 좋아하는 거 저장해둬

5. none
장기기억과 관계없는 일반 요청

규칙:

- 단어 일치가 아니라 문장의 의미를 판단한다.
- 사용자가 정확한 key 이름을 말하지 않아도 의미가 같으면 연결한다.
- currentFacts에 있는 key를 최대한 활용한다.
- recall일 경우 답변에 필요한 key만 relevantKeys에 넣는다.
- 전체 사용자 정보를 묻는 경우 relevantKeys는 빈 배열로 둔다.
- 확실하지 않으면 intent를 none으로 한다.
- confidence는 0부터 1 사이 숫자다.
- 없는 기억을 있다고 추측하지 않는다.

반드시 JSON만 출력한다.

형식:

{
  "intent": "recall",
  "relevantKeys": [
    "school_name"
  ],
  "confidence": 0.98
}
`,

      input: `
현재 저장된 사용자 장기기억:

${availableFacts}

사용자 메시지:

${message}

이 메시지의 장기기억 관련 의도를 분석해.
`,
    });

  const raw =
    response.output_text.trim();

  if (!raw) {
    return {
      intent: "none",
      relevantKeys: [],
      confidence: 0,
    };
  }

  try {
    const cleaned = raw
      .replace(/^```json\s*/iu, "")
      .replace(/^```\s*/u, "")
      .replace(/\s*```$/u, "")
      .trim();

    const parsed =
      JSON.parse(
        cleaned,
      ) as MemorySemanticAnalysisResult;

    const validIntents: MemorySemanticIntent[] = [
      "recall",
      "update",
      "delete",
      "add",
      "none",
    ];

    const intent =
      typeof parsed.intent === "string" &&
      validIntents.includes(
        parsed.intent as MemorySemanticIntent,
      )
        ? (
            parsed.intent as MemorySemanticIntent
          )
        : "none";

    const relevantKeys =
      Array.isArray(parsed.relevantKeys)
        ? parsed.relevantKeys.filter(
            (key): key is string =>
              typeof key === "string" &&
              key.trim().length > 0,
          )
        : [];

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(
            0,
            Math.min(
              1,
              parsed.confidence,
            ),
          )
        : 0;

    return {
      intent,
      relevantKeys,
      confidence,
    };
  } catch (error) {
    console.error(
      "[L-AI Memory Semantic] Failed to parse intent:",
      error,
    );

    return {
      intent: "none",
      relevantKeys: [],
      confidence: 0,
    };
  }
}

export type LearningDeleteTarget =
  | {
      kind: "specific";
      category: string;
      key: string;
    }
  | {
      kind: "recent";
    }
  | {
      kind: "none";
    };

type LearningDeleteAnalysisResult = {
  kind?: unknown;
  category?: unknown;
  key?: unknown;
};

export async function extractLearningDeleteTarget(
  message: string,
): Promise<LearningDeleteTarget> {
  const openai = getOpenAIClient();

  const response =
    await openai.responses.create({
      model: getOpenAIModel(),

      instructions: `
너는 L-AI의 장기기억 삭제 요청 분석기다.

사용자가 어떤 장기기억을 삭제하고 싶은지 분석한다.

가능한 결과는 3가지다.

1. 특정 기억 삭제

예:
"내 생일 정보 기억하지 마"
→
{
  "kind": "specific",
  "category": "identity",
  "key": "birthday"
}

"내 이름 정보 지워줘"
→
{
  "kind": "specific",
  "category": "identity",
  "key": "name"
}

2. 가장 최근에 학습한 정보 삭제

예:
"방금 가르쳐준 거 기억하지 마"
"아까 저장한 정보 삭제해줘"
→
{
  "kind": "recent"
}

3. 삭제 대상을 특정할 수 없음

→
{
  "kind": "none"
}

규칙:

- 사용자가 실제로 삭제하려는 기억만 판단한다.
- 추측해서 엉뚱한 key를 만들지 않는다.
- category는 다음 중 가장 가까운 것을 사용한다.

identity
preference
habit
communication
school
work
project
relationship
goal
other

- key는 기존 학습 규칙과 동일한 영어 식별자를 사용한다.

예:
name
birthday
favorite_food
development_guidance
current_project

반드시 JSON만 출력한다.
`,

      input: `
사용자 요청:

${message}

삭제하려는 장기기억 대상을 분석해.
`,
    });

  const raw =
    response.output_text.trim();

  if (!raw) {
    return {
      kind: "none",
    };
  }

  try {
    const cleaned = raw
      .replace(/^```json\s*/iu, "")
      .replace(/^```\s*/u, "")
      .replace(/\s*```$/u, "")
      .trim();

    const parsed =
      JSON.parse(
        cleaned,
      ) as LearningDeleteAnalysisResult;

    if (parsed.kind === "recent") {
      return {
        kind: "recent",
      };
    }

    if (
      parsed.kind === "specific" &&
      typeof parsed.category === "string" &&
      parsed.category.trim() &&
      typeof parsed.key === "string" &&
      parsed.key.trim()
    ) {
      return {
        kind: "specific",
        category:
          parsed.category.trim(),
        key:
          parsed.key.trim(),
      };
    }

    return {
      kind: "none",
    };
  } catch (error) {
    console.error(
      "[L-AI Learning] Failed to parse delete target:",
      error,
    );

    return {
      kind: "none",
    };
  }
}
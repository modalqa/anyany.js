// File: prompts.js

export const PROMPTS = {
  // ===================================
  // Prompts Spesifik untuk QA & Testing
  // ===================================

  /**
   * Menganalisis deskripsi bug atau log untuk memberikan laporan terstruktur.
   */
  BUG_ANALYSIS: `Analyze the following bug description or log and provide a structured output in this format:

- Bug Title: Clear and concise summary
- Possible Cause: Potential cause from system, UI/UX, backend, API, or database
- Steps to Reproduce: Detailed steps to reproduce the bug
- Expected Result: What should have happened
- Actual Result: What actually happened
- Impact Level: Low / Medium / High / Critical – based on user impact
- Suggested Next Step: Recommended action for the QA/Dev team
`,

  /**
   * Menganalisis skenario pengujian untuk menentukan prioritasnya.
   */
  SCENARIO_PRIORITY_ANALYSIS: `Analyze the following test scenarios and determine their priority (High, Medium, Low) based on user impact, likelihood, and implementation complexity. Provide logical justification for each assessment.

Output format:
- Scenario Description: [Scenario summary]
- Priority: [High / Medium / Low]
- Justification: [Logical reason for the chosen priority based on user impact, usage frequency, and technical complexity/risk]
`,

  /**
   * Menghasilkan data uji (valid, invalid, edge case) berdasarkan deskripsi skenario.
   * Meminta output dalam format JSON.
   */
  TEST_DATA_GENERATOR: `Generate test data based on the following scenario description. The output must be a valid JSON array of objects. Each object should represent a data field and include:
- "fieldName": Name of the required field/data
- "validData": Example of valid data for positive testing
- "invalidData": Example of invalid data for negative testing (to check error/validation handling)
- "edgeCaseData": Example of data at the boundaries or extreme limits
- "justification": Brief reason for choosing this data set

Do not include any text or formatting outside of the JSON array.
`,

  /**
   * Menghasilkan test suite kontrak API berdasarkan contoh payload JSON.
   */
  API_CONTRACT_TEST: `Based on the following example JSON payload, act as a QA Automation Engineer. Your task is to generate a comprehensive API contract test suite in Markdown format.

From the JSON, first, infer the contract for each field:
1.  **Data Type:** (e.g., string, number, boolean, array, object, null).
2.  **Constraints:** (e.g., required, optional, specific format like email or UUID, possible enum values).
3.  **Potential Edge Cases:** (e.g., empty strings, 0, negative numbers, empty arrays, null values where not expected).

Then, generate two sets of test cases using Markdown tables:

### Positive Test Cases (Happy Path)
A test case with a valid payload conforming to all inferred contract rules.

### Negative Test Cases (Unhappy Path)
- A separate test for each field with the **wrong data type**.
- A separate test for each **missing required field**.
- A separate test for fields with **invalid formats or values** (e.g., bad email format).
- A separate test for any other broken constraints (e.g., strings that are too long, numbers out of range).
`,

  // ===================================
  // Prompts untuk Tujuan Umum
  // ===================================

  /**
   * Meringkas teks menjadi beberapa poin kunci.
   */
  SUMMARIZE: 'Summarize the following text into a few key points:',

  /**
   * Menerjemahkan teks ke dalam Bahasa Inggris.
   */
  TRANSLATE: 'Translate the following text to English:',

  /**
   * Melakukan review kode dengan fokus pada best practice, performa, dan potensi bug.
   */
  CODE_REVIEW: 'Act as a senior software engineer and perform a thorough code review on the following snippet. Focus on best practices, performance, security vulnerabilities, and potential bugs. Provide constructive feedback with code examples where possible.',

  /**
   * Menganalisis kualitas dokumen QA (test plan/case)
   */
  QA_DOC_CHECKER: `Act as a Senior QA Lead and analyze the following QA document (test plan/test case). Provide a detailed quality assessment focusing on:

1. Completeness Analysis:
   - Check if all critical test areas are covered
   - Verify test preconditions and prerequisites
   - Validate test steps clarity and expected results

2. Coverage Assessment:
   - Functional coverage score (0-5)
   - Edge cases and boundary conditions
   - Error scenarios and exception handling
   - Cross-browser/device considerations (if applicable)

3. Ambiguity Check:
   - Identify unclear or ambiguous steps
   - Flag incomplete or missing information
   - Highlight assumptions that need clarification

4. Gap Analysis:
   - Uncovered test scenarios
   - Missing validations
   - Potential risks not addressed

5. Overall Assessment:
   - Document Status: Complete/Incomplete
   - Coverage Score: 0-5 (with justification)
   - Key Strengths
   - Areas for Improvement

6. Recommendations:
   - Specific suggestions for improvements
   - Additional test scenarios to consider
   - Best practices to implement

Please provide the output in a structured format suitable for both human reading and JSON parsing.

Analyze the following QA document:
`,

  // ===================================
  // Prompt Cadangan
  // ===================================

  /**
   * Digunakan ketika tidak ada prompt khusus yang dipilih. AI akan merespons berdasarkan input saja.
   */
  CUSTOM_TASK: '' // Sengaja dikosongkan untuk tugas kustom tanpa prompt dasar.
};
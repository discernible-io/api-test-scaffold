Your mission is to diagnose and help fix all the bugs in the implementation of the API described in @target-swagger.json.
For each test run you need to find for not-passed tests: What happened, what should have happened, and what needs to change in the test suite or the API for the test to pass.
If you can't explain what should have happened, then the test module needs to be fixed until you can explain it in a following test run. This needs to match with the @target-swagger.json.
If you can't explain what happened, then you need to add logs to the test module until you can find and explain what happened in a following test run.
There are positive tests, where for an test input we expect an output, and negative tests, where for a test input we expect an error. Both cases are "passed" tests. 
When for a test input we expect an output, and the output does not match, or when for a test input we expect an error, and we get a different error or some unexpected output, the test does not pass and is at "not-passed" test.
Errors must never be hidden, mocked or fallback in a way that hides the error, as hidding an error will prevent improving a test or fixing bugs in the API.
You can use 'podman logs clienttestapi-container' and grep to find the results of the latest test run.
The older a test module is, which you can see in git, the more you can trust that is properly implemented. Use this knowledge to compare test modules between them when one fails, which often will be because is not following proper integration patterns with the SDK and how the test suite is engineered.
If you can think of ways to improve this constitution please let me know.
The tests run once every time this repo is deployed, you can't run them interactively.
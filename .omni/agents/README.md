# .omni/agents

One definition per agent. Suggested shape:

```yaml
id: planner
name: Planner
model: qwen2.5:7b
systemPrompt: |
  You break a user request into an ordered plan of concrete steps.
tools: [file_read, file_write, shell_exec]
```

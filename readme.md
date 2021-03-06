# CC GitLab 辅助控制台

一直以来我们在 GitLab 上的代码都是 merge request 的提交者提了之后自己顺手 merge 掉，基本上没有任何同事做 review。缺乏 code review 就导致很多明显的错误难以避免，重复犯错重复开发等浪费时间的行为，我们也无法作为团队整体在不断的开发过程中成长。而引入强制性的 code review 对于项目上的代码更新，大家至少相互之间了解别人都做了什么事情，下次自己遇到类似的问题就知道谁解决过可以直接使用或者参考之前的代码，而对于基础性的框架和类库的改动，对每个开发者都会有影响，出问题的话可能会带来较大的麻烦，所以希望大家能在危害发生之前能够及时制止，也对新增加的功能心中有数。

GitLab 缺乏禁止提交者自己 merge 代码或者根据投票决定是否可 merge 的规则设置，所以做了这个小工具。原理很简单，给 CCFE 组的所有成员降级为 Developer 只能提交 merge request 而不能 merge，保留一个有 merge 权限的帐号在这个工具里发起 merge。所有开发者都应该相互 review 彼此的代码并且有权决定改动是否应该入库。

规则是有两个或以上的人支持，并且没有人反对的时候，在辅助控制台就可以点击 merge 按钮。对于指定了 assignee 的 merge request，如果 assignee 同意而没有其他人提出异议（也就是说有且仅有 assignee 一个人表示支持的情况），就可以直接 merge。投票方式是在 merge request 的评论中回复单词“yea”或包含“yea”（两边有空格）的评论表示支持 merge，回复其他内容表示反对，当提交者解释清楚可以接受再回复“yea”就变为支持，每个人按最后一条回复看有没有“yea”。针对某一行代码的评论与直接评论整个 merge request 是相同的效果。如果提交者继续 push 了其他代码改动，之前的投票状态会被重设，需要重新收集 yea。

（代码的改动也是从评论中发现“add x commits”来决定的，测试过程中发现 GitLab 有时候可能 push 上去而无法触发这样的评论，可能这个问题只能在升级 GitLab 后通过新的从 merge request 里面取 changes 的 API 来解决）

对于新提交的 merge review，还有五分钟的时间窗口，避免这个 review 机制形同虚设，如果 review 太快，就多看两眼吧。

希望大家尽量多吐槽别人的代码，把自己的代码写漂亮，共同进步！

关于这个 ccconsole，将来计划加入创建新项目的模板（直接生成汇付版本、联动版本等等）。其他建议欢迎在 Issues 里提出探讨。

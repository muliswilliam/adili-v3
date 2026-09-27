<#ftl output_format="plainText">
<#-- Plain-text variant of html/executeActions.ftl; see there. -->
<#import "../html/invitation.ftl" as invitation>
<#assign i = invitation.details()>
<#if i.invited>
${msg("adiliInviteTitle", i.roleTitle)}
<#else>
${msg("adiliSetupTitle")}
</#if>

${i.greeting}

<#if i.invited>
${msg("adiliInviteLead", i.roleTitle, i.commission)}
<#if i.duty?has_content>

${i.duty}
</#if>

${msg("adiliDetailCommission")}: ${i.commission}
${msg("adiliDetailRole")}: ${i.roleTitle?cap_first}
<#if user.email?has_content>
${msg("adiliDetailEmail")}: ${user.email}
</#if>
<#else>
${msg("adiliSetupLead")}
</#if>
<#if i.steps?has_content>

${msg(i.invited?then("adiliStepsIntro", "adiliStepsIntroSetup"))}

<#list i.steps as step>
${step?counter}. ${step.title}<#if step.detail?has_content>
   ${step.detail}</#if>
</#list>
</#if>

${msg(i.invited?then("adiliInviteButton", "adiliSetupButton"))}:
${link}

${msg("adiliLinkExpiry", i.expiry)} ${msg(i.invited?then("adiliLinkExpiredInvite", "adiliLinkExpiredSetup"))}

--
${msg("adiliEmailFooter")}

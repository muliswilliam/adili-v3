<#--
  Execute-actions email: the activation email of a staff account (spec 01, user stories 21, 22
  and 25) or of a law-enforcement officer's account (spec 10), which names the agency instead of
  a Commission. The directory sets the account's `commissionName` and `invitedRole` attributes
  before it asks Keycloak to send this email; without them the email falls back to a generic
  "complete your account setup" message.
-->
<#import "template.ftl" as layout>
<#import "invitation.ftl" as invitation>
<#assign i = invitation.details()>
<#assign font = "font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<#-- Bold, escaped text to pass into an HTML message. -->
<#function strong text><#return "<strong style=\"font-weight:600;color:#1a1a1a;\">" + text?esc?markup_string + "</strong>"></#function>
<@layout.emailLayout preheader=i.preheader>
<#if i.invited>
<p style="margin:0 0 8px;font-size:13px;line-height:20px;font-weight:600;color:#1a1a1a;">${msg("adiliInviteEyebrow")}</p>
<h1 style="margin:0 0 20px;${font}font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.015em;color:#1a1a1a;">${msg("adiliInviteTitle", i.roleTitle)}</h1>
<#else>
<h1 style="margin:0 0 20px;${font}font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.015em;color:#1a1a1a;">${msg("adiliSetupTitle")}</h1>
</#if>
<p style="margin:0 0 16px;">${i.greeting}</p>
<#if i.invited>
<p style="margin:0 0 16px;">${msg("adiliInviteLead", strong(i.roleTitle), strong(i.commission))?no_esc}</p>
<#if i.duty?has_content>
<p style="margin:0 0 24px;">${i.duty}</p>
</#if>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;background-color:#f4f3f1;border-radius:8px;">
  <tr>
    <td style="padding:16px 20px;${font}font-size:14px;line-height:22px;color:#1a1a1a;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td class="detail-label" width="112" style="padding:2px 12px 2px 0;vertical-align:top;${font}font-size:13px;line-height:22px;color:#6f6e6b;">${i.commissionLabel}</td>
          <td class="detail-value" style="padding:2px 0;vertical-align:top;${font}font-size:14px;line-height:22px;font-weight:600;color:#1a1a1a;">${i.commission}</td>
        </tr>
        <tr>
          <td class="detail-label" width="112" style="padding:2px 12px 2px 0;vertical-align:top;${font}font-size:13px;line-height:22px;color:#6f6e6b;">${msg("adiliDetailRole")}</td>
          <td class="detail-value" style="padding:2px 0;vertical-align:top;${font}font-size:14px;line-height:22px;color:#1a1a1a;">${i.roleTitle?cap_first}</td>
        </tr>
        <#if user.email?has_content>
        <tr>
          <td class="detail-label" width="112" style="padding:2px 12px 2px 0;vertical-align:top;${font}font-size:13px;line-height:22px;color:#6f6e6b;">${msg("adiliDetailEmail")}</td>
          <td class="detail-value" style="padding:2px 0;vertical-align:top;${font}font-size:14px;line-height:22px;color:#1a1a1a;overflow-wrap:anywhere;">${user.email}</td>
        </tr>
        </#if>
      </table>
    </td>
  </tr>
</table>
<#else>
<p style="margin:0 0 24px;">${msg("adiliSetupLead")}</p>
</#if>
<#if i.steps?has_content>
<p style="margin:0 0 12px;font-weight:600;">${msg(i.invited?then("adiliStepsIntro", "adiliStepsIntroSetup"))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  <#list i.steps as step>
  <tr>
    <td width="36" style="padding:0 0 14px;vertical-align:top;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" width="24" height="24" style="width:24px;height:24px;border-radius:12px;background-color:#f4f3f1;${font}font-size:12px;line-height:24px;font-weight:600;color:#4a4a48;">${step?counter}</td>
        </tr>
      </table>
    </td>
    <td style="padding:1px 0 14px;vertical-align:top;${font}font-size:15px;line-height:22px;color:#1a1a1a;">
      <strong style="font-weight:600;">${step.title}</strong><#if step.detail?has_content><br><span style="color:#6f6e6b;">${step.detail}</span></#if>
    </td>
  </tr>
  </#list>
</table>
</#if>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
  <tr>
    <td align="center" style="border-radius:8px;background-color:#1a1a1a;">
      <a href="${link}" target="_blank" style="display:inline-block;padding:12px 24px;${font}font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${msg(i.invited?then("adiliInviteButton", "adiliSetupButton"))}</a>
    </td>
  </tr>
</table>
<p style="margin:0 0 16px;">${msg("adiliLinkExpiry", strong(i.expiry))?no_esc}<#if i.invited> ${msg("adiliLinkExpiredInvite")}<#else> ${msg("adiliLinkExpiredSetup")}</#if></p>
<p style="margin:0;padding-top:20px;border-top:1px solid #e8e6e3;font-size:13px;line-height:20px;color:#6f6e6b;">${msg("adiliLinkFallback")}<br><a href="${link}" target="_blank" style="font-size:12px;line-height:18px;color:#1a1a1a;word-break:break-all;">${link}</a></p>
</@layout.emailLayout>
